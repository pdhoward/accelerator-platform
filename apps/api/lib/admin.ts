import {
  canPlatform,
  type AccountStatus,
  type AdminAccountDetail,
  type AdminAccountRow,
  type AdminOverview,
  type AuditEntry,
  type Identity,
  type NewAccountInput,
  type PlatformStaff,
  type Role,
} from "@accelerator/domain";

import { CodeError } from "./codes";
import { db, rows, type Row } from "./supabase";

/**
 * Platform Admin queries (across every account). Service-role reads; callers
 * are gated by platformRoute(permission) before reaching here. Every write is
 * audited.
 */

const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
const num = (v: unknown) => Number(v ?? 0) || 0;

export async function audit(identity: Identity, action: string, orgId: string | null, detail: Record<string, unknown> = {}) {
  const { error } = await db().from("acc_admin_audit").insert({ actor_user_id: identity.userId, actor_email: identity.email, action, org_id: orgId, detail });
  if (error) throw new Error(error.message);
}

/** One pass over the tables the accounts list and overview both need. */
async function snapshot() {
  const [orgs, members, sites, subs, usage, requests] = await Promise.all([
    rows(db().from("acc_orgs").select("*").order("created_at")),
    rows(db().from("acc_members").select("org_id")),
    rows(db().from("acc_sites").select("org_id")),
    rows(db().from("acc_subscriptions").select("org_id, status, mrr_usd")),
    rows(db().from("acc_usage").select("org_id, cost_usd").gte("at", monthStart())),
    rows(db().from("acc_requests").select("org_id, stage, created_at")),
  ]);
  const by = <T>(list: Row[], orgId: string, f: (r: Row) => T) => list.filter((r) => r.org_id === orgId).map(f);
  const accounts: AdminAccountRow[] = orgs.map((o) => {
    const id = o.id as string;
    const reqs = requests.filter((r) => r.org_id === id);
    return {
      id,
      name: o.name as string,
      status: o.status as AccountStatus,
      plan: o.plan as AdminAccountRow["plan"],
      billingMode: o.billing_mode as AdminAccountRow["billingMode"],
      installFeeQuoteUsd: o.install_fee_quote_usd == null ? null : num(o.install_fee_quote_usd),
      mrrUsd: by(subs, id, (s) => (s.status === "active" ? num(s.mrr_usd) : 0)).reduce((a, b) => a + b, 0),
      members: by(members, id, () => 1).length,
      sites: by(sites, id, () => 1).length,
      aiSpendMonthUsd: Math.round(by(usage, id, (u) => num(u.cost_usd)).reduce((a, b) => a + b, 0) * 100) / 100,
      openRequests: reqs.filter((r) => r.stage !== "done" && r.stage !== "watch").length,
      createdAt: o.created_at as string,
      lastActivityAt: reqs.map((r) => r.created_at as string).sort().pop() ?? null,
    };
  });
  return { accounts, requests };
}

export async function listAccounts(): Promise<AdminAccountRow[]> {
  return (await snapshot()).accounts;
}

export async function overview(identity: Identity): Promise<AdminOverview> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [{ accounts, requests }, staff, invites, texts, members] = await Promise.all([
    snapshot(),
    rows(db().from("acc_platform_admins").select("user_id")),
    rows(db().from("acc_invites").select("id").is("accepted_at", null).is("revoked_at", null)),
    rows(db().from("acc_sms_log").select("status").gte("at", dayAgo)),
    rows(db().from("acc_members").select("id")),
  ]);
  const statuses: AccountStatus[] = ["invited", "onboarding", "active", "past_due", "suspended", "cancelled"];
  const counts = Object.fromEntries(statuses.map((s) => [s, accounts.filter((a) => a.status === s).length])) as Record<AccountStatus, number>;
  const mrr = accounts.reduce((s, a) => s + a.mrrUsd, 0);
  const ai = Math.round(accounts.reduce((s, a) => s + a.aiSpendMonthUsd, 0) * 100) / 100;
  const text = (s: string) => texts.filter((t) => t.status === s).length;

  return {
    accounts: { ...counts, total: accounts.length },
    people: { members: members.length, platformStaff: staff.length, openInvites: invites.length },
    work: {
      openRequests: accounts.reduce((s, a) => s + a.openRequests, 0),
      changesInFlight: requests.filter((r) => ["build", "prove", "try", "ship"].includes(r.stage as string)).length,
    },
    aiSpendMonthUsd: ai,
    textsLast24h: { sent: text("sent"), suppressed: text("suppressed"), failed: text("failed") },
    revenue: canPlatform(identity.platformRole, "revenue.view")
      ? {
          mrrUsd: mrr,
          arrUsd: mrr * 12,
          installFeesQuotedUsd: accounts.reduce((s, a) => s + (a.installFeeQuoteUsd ?? 0), 0),
          grossMarginMonthUsd: Math.round((mrr - ai) * 100) / 100,
        }
      : undefined,
  };
}

export async function auditList(orgId?: string, limit = 200): Promise<AuditEntry[]> {
  let q = db().from("acc_admin_audit").select("id, at, actor_email, action, org_id, detail, acc_orgs(name)").order("at", { ascending: false }).limit(limit);
  if (orgId) q = q.eq("org_id", orgId);
  return (await rows(q)).map((r) => {
    const org = (Array.isArray(r.acc_orgs) ? r.acc_orgs[0] : r.acc_orgs) as { name?: string } | null;
    return {
      id: r.id as number,
      at: r.at as string,
      actorEmail: (r.actor_email as string) ?? null,
      action: r.action as string,
      orgId: (r.org_id as string) ?? null,
      orgName: org?.name ?? null,
      detail: (r.detail as Record<string, unknown>) ?? {},
    };
  });
}

export async function accountDetail(id: string): Promise<AdminAccountDetail | undefined> {
  const row = (await listAccounts()).find((a) => a.id === id);
  if (!row) return undefined;
  const [org, people, invites, siteList, auditTrail] = await Promise.all([
    rows(db().from("acc_orgs").select("suspended_at, suspended_reason").eq("id", id)),
    rows(db().from("acc_members").select("id, name, email, role").eq("org_id", id).order("created_at")),
    rows(db().from("acc_invites").select("id, email, role, created_at").eq("org_id", id).is("accepted_at", null).is("revoked_at", null)),
    rows(db().from("acc_sites").select("id, slug, name, url").eq("org_id", id).order("created_at")),
    auditList(id, 50),
  ]);
  return {
    ...row,
    suspendedAt: (org[0]?.suspended_at as string) ?? null,
    suspendedReason: (org[0]?.suspended_reason as string) ?? null,
    people: people.map((p) => ({ id: p.id as string, name: p.name as string, email: (p.email as string) ?? null, role: p.role as Role })),
    invites: invites.map((i) => ({ id: i.id as string, email: i.email as string, role: i.role as Role, createdAt: i.created_at as string })),
    siteList: siteList as AdminAccountDetail["siteList"],
    audit: auditTrail,
  };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/^https?:\/\//, "").replace(/\.[a-z]+(\/.*)?$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "site";

/** Owner-provisioned account: org + first site + the owner's invite (invite-only launch). */
export async function createAccount(identity: Identity, input: NewAccountInput): Promise<{ id: string }> {
  const { data: org, error } = await db()
    .from("acc_orgs")
    .insert({
      name: input.name,
      plan: input.plan,
      billing_mode: input.billingMode,
      install_fee_quote_usd: input.installFeeQuoteUsd ?? null,
      status: "onboarding",
      created_by: identity.userId,
    })
    .select("id")
    .single();
  if (error || !org) throw new Error(error?.message ?? "Couldn't create the account.");

  const url = /^https?:\/\//.test(input.siteUrl) ? input.siteUrl : `https://${input.siteUrl}`;
  const [site, invite] = await Promise.all([
    db().from("acc_sites").insert({ org_id: org.id, slug: slugify(input.siteUrl), name: input.siteName, url, repo: "", status: "onboarding" }),
    db().from("acc_invites").insert({ org_id: org.id, email: input.ownerEmail.toLowerCase(), role: "owner", invited_by: identity.userId }),
  ]);
  if (site.error || invite.error) throw new Error((site.error ?? invite.error)!.message);

  await audit(identity, "account.create", org.id, { name: input.name, plan: input.plan, billingMode: input.billingMode, owner: input.ownerEmail.toLowerCase() });
  return { id: org.id };
}

export async function setAccountStatus(identity: Identity, id: string, action: "suspend" | "resume", reason: string) {
  const patch =
    action === "suspend"
      ? { status: "suspended", suspended_at: new Date().toISOString(), suspended_reason: reason }
      : { status: "active", suspended_at: null, suspended_reason: null };
  const { error } = await db().from("acc_orgs").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await audit(identity, `account.${action}`, id, { reason });
}

export async function invite(identity: Identity, orgId: string, email: string, role: Role) {
  const { error } = await db().from("acc_invites").insert({ org_id: orgId, email: email.toLowerCase(), role, invited_by: identity.userId });
  if (error) throw new Error(error.message);
  await audit(identity, "account.invite", orgId, { email: email.toLowerCase(), role });
}

// ── Members ──────────────────────────────────────────────────────────────────
export type MemberEdit = { name?: string; email?: string; role?: Role };

async function memberRow(orgId: string, memberId: string) {
  const [m] = await rows(db().from("acc_members").select("id, email, role").eq("org_id", orgId).eq("id", memberId));
  if (!m) throw new CodeError("That member isn't on this account.");
  return m as { id: string; email: string | null; role: Role };
}

/** Every account keeps at least one Owner. */
async function keepAnOwner(orgId: string, leavingId: string) {
  const owners = await rows(db().from("acc_members").select("id").eq("org_id", orgId).eq("role", "owner").neq("id", leavingId));
  if (!owners.length) throw new CodeError("An account needs at least one Owner. Make someone else Owner first.");
}

/**
 * Edit a member. A new email moves the seat: whoever next signs in with that
 * email takes it over (identity.ts settle), like an invite that keeps the name and role.
 */
export async function updateMember(identity: Identity, orgId: string, memberId: string, input: MemberEdit) {
  const m = await memberRow(orgId, memberId);
  if (m.role === "owner" && input.role && input.role !== "owner") await keepAnOwner(orgId, memberId);
  const email = input.email?.trim().toLowerCase();
  if (email && email !== m.email) {
    const clash = await rows(db().from("acc_members").select("id").eq("org_id", orgId).eq("email", email).neq("id", memberId));
    if (clash.length) throw new CodeError(`${email} is already on this account.`);
  }
  const { error } = await db()
    .from("acc_members")
    .update({ ...(input.name && { name: input.name.trim() }), ...(email && { email }), ...(input.role && { role: input.role }) })
    .eq("id", memberId);
  if (error) throw new Error(error.message);
  await audit(identity, "member.update", orgId, { member: m.email, ...input, ...(email && { email }) });
}

export async function removeMember(identity: Identity, orgId: string, memberId: string) {
  const m = await memberRow(orgId, memberId);
  if (m.role === "owner") await keepAnOwner(orgId, memberId);
  const { error } = await db().from("acc_members").delete().eq("id", memberId);
  if (error) throw new Error(error.message);
  await audit(identity, "member.remove", orgId, { member: m.email, role: m.role });
}

export async function team(): Promise<PlatformStaff[]> {
  return (await rows(db().from("acc_platform_admins").select("user_id, email, role, added_at").order("added_at"))).map((r) => ({
    userId: r.user_id as string,
    email: r.email as string,
    role: r.role as PlatformStaff["role"],
    addedAt: r.added_at as string,
  }));
}
