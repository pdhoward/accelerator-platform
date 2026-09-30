import type { Identity, Membership, PlatformRole, Role } from "@accelerator/domain";

import { checkCode, CodeError, issueCode } from "./codes";
import { consoleUrl, devAllowlist, isProduction, platformAdminEmails } from "./env";
import { sendMail } from "./mail";
import { maskPhone, toE164 } from "./phone";
import { db } from "./supabase";

/**
 * Who is signed in, and what they may start. Supabase Auth owns the session;
 * this file owns our rules on top: platform roles, invite-only entry, first-
 * sign-in setup, the mobile number, and turning a texted code into a session.
 */

const now = () => new Date().toISOString();

// ── Identity from a Supabase access token (cached briefly per token) ───────
const cache = new Map<string, { identity: Identity; until: number }>();

export async function identityFromToken(token: string): Promise<Identity | null> {
  const hit = cache.get(token);
  if (hit && hit.until > Date.now()) return hit.identity;

  const { data, error } = await db().auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (error || !data.user || !email) return null;

  const identity: Identity = { userId: data.user.id, email, platformRole: await platformRole(data.user.id, email) };
  if (cache.size > 500) cache.clear();
  cache.set(token, { identity, until: Date.now() + 60_000 });
  return identity;
}

/** Platform role from the allow-list; PLATFORM_ADMIN_EMAILS bootstraps Owners on first sign-in. */
async function platformRole(userId: string, email: string): Promise<PlatformRole | null> {
  const { data } = await db().from("acc_platform_admins").select("role").eq("user_id", userId).maybeSingle();
  if (data) return data.role as PlatformRole;
  if (!platformAdminEmails().includes(email)) return null;
  await db().from("acc_platform_admins").upsert({ user_id: userId, email, role: "owner" }, { onConflict: "user_id" });
  return "owner";
}

// ── Invite-only entry ────────────────────────────────────────────────────────
/** Outside production: DEV_ALLOWLIST only. In production: staff, members and invitees. */
export async function mayStartSignIn(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!isProduction()) return devAllowlist().includes(e);
  if (platformAdminEmails().includes(e)) return true;
  const [admin, invite, member] = await Promise.all([
    db().from("acc_platform_admins").select("user_id").eq("email", e).limit(1),
    db().from("acc_invites").select("id").eq("email", e).is("accepted_at", null).is("revoked_at", null).limit(1),
    db().from("acc_members").select("id").eq("email", e).limit(1),
  ]);
  return !!(admin.data?.length || invite.data?.length || member.data?.length);
}

// ── First sign-in: profile row, and pending invites become memberships ─────
export async function settle(identity: Identity) {
  await db().from("acc_profiles").upsert({ user_id: identity.userId, email: identity.email }, { onConflict: "user_id", ignoreDuplicates: true });
  // Seats an admin moved to this email (admin.ts updateMember) are claimed on sign-in.
  await db().from("acc_members").update({ user_id: identity.userId }).eq("email", identity.email).neq("user_id", identity.userId);
  const { data: invites } = await db()
    .from("acc_invites")
    .select("id, org_id, role")
    .eq("email", identity.email)
    .is("accepted_at", null)
    .is("revoked_at", null);
  for (const inv of invites ?? []) {
    await db()
      .from("acc_members")
      .upsert(
        { org_id: inv.org_id, user_id: identity.userId, email: identity.email, name: identity.email.split("@")[0], role: inv.role },
        { onConflict: "org_id,user_id", ignoreDuplicates: true },
      );
    await db().from("acc_invites").update({ accepted_at: now() }).eq("id", inv.id);
  }
}

export async function profile(userId: string) {
  const { data } = await db().from("acc_profiles").select("mobile_e164, mobile_verified_at").eq("user_id", userId).maybeSingle();
  return {
    mobileMasked: data?.mobile_e164 ? maskPhone(data.mobile_e164) : null,
    mobileVerified: !!data?.mobile_verified_at,
  };
}

export async function memberships(userId: string): Promise<Membership[]> {
  const { data: rows } = await db().from("acc_members").select("org_id, role, acc_orgs(name, status)").eq("user_id", userId);
  if (!rows?.length) return [];
  const { data: sites } = await db()
    .from("acc_sites")
    .select("id, slug, name, url, org_id")
    .in("org_id", rows.map((r) => r.org_id))
    .order("created_at");
  return rows.map((r) => {
    const org = (Array.isArray(r.acc_orgs) ? r.acc_orgs[0] : r.acc_orgs) as { name: string; status: Membership["status"] } | null;
    return {
      orgId: r.org_id as string,
      orgName: org?.name ?? "Account",
      role: r.role as Role,
      status: org?.status ?? "active",
      sites: (sites ?? []).filter((s) => s.org_id === r.org_id).map(({ id, slug, name, url }) => ({ id, slug, name, url })),
    };
  });
}

// ── Mobile number (captured and verified on first sign-in) ─────────────────
export async function startMobile(identity: Identity, input: string, consentText: string) {
  const mobile = toE164(input);
  if (!mobile) throw new CodeError("That doesn't look like a mobile number. Include the country code, e.g. +44 7700 900123.");
  await db()
    .from("acc_profiles")
    .upsert(
      { user_id: identity.userId, email: identity.email, mobile_e164: mobile, mobile_verified_at: null, sms_consent_at: now(), sms_consent_text: consentText },
      { onConflict: "user_id" },
    );
  return issueCode({ email: identity.email, mobile, purpose: "verify_mobile" });
}

export async function verifyMobile(identity: Identity, code: string) {
  if (!(await checkCode({ email: identity.email, purpose: "verify_mobile", code }))) throw new CodeError("That code isn't right, or it has expired.");
  await db().from("acc_profiles").update({ mobile_verified_at: now() }).eq("user_id", identity.userId);
}

// ── Sign in with a texted code ───────────────────────────────────────────────
export async function startSmsSignIn(email: string) {
  const e = email.trim().toLowerCase();
  if (!(await mayStartSignIn(e))) throw new CodeError("This account is invite-only. Ask your administrator for an invite.");
  const { data } = await db().from("acc_profiles").select("mobile_e164, mobile_verified_at").eq("email", e).maybeSingle();
  if (!data?.mobile_e164 || !data.mobile_verified_at) throw new CodeError("Text sign-in starts once your mobile is verified. Use the email link this first time.");
  return issueCode({ email: e, mobile: data.mobile_e164, purpose: "sign_in" });
}

/**
 * Right code → a one-time Supabase sign-in token. The console exchanges it
 * with verifyOtp({ type: "magiclink", token_hash }) to set the session.
 */
export async function finishSmsSignIn(email: string, code: string): Promise<{ tokenHash: string }> {
  const e = email.trim().toLowerCase();
  if (!(await mayStartSignIn(e)) || !(await checkCode({ email: e, purpose: "sign_in", code }))) {
    throw new CodeError("That code isn't right, or it has expired.");
  }
  return { tokenHash: await signInToken(e) };
}

/**
 * A one-time Supabase sign-in token for an allowed email (the console
 * exchanges it with verifyOtp({ type: "magiclink", token_hash })). Creates
 * the auth user on a first sign-in.
 */
async function signInToken(email: string): Promise<string> {
  let link = await db().auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    await db().auth.admin.createUser({ email, email_confirm: true });
    link = await db().auth.admin.generateLink({ type: "magiclink", email });
  }
  const tokenHash = link.data?.properties?.hashed_token;
  if (!tokenHash) throw new Error(link.error?.message ?? "Couldn't create the sign-in session.");
  return tokenHash;
}

// ── Sign in with an emailed link ─────────────────────────────────────────────
/**
 * We send the link ourselves (lib/mail.ts), so it always points at our own
 * Control Room URL, never at an address the request supplied.
 */
export async function sendEmailSignIn(email: string, next?: string) {
  const e = email.trim().toLowerCase();
  if (!(await mayStartSignIn(e))) throw new CodeError("This account is invite-only. Ask your administrator for an invite.");
  const link = new URL(`${consoleUrl()}/auth/confirm`);
  link.searchParams.set("token_hash", await signInToken(e));
  if (next?.startsWith("/") && !next.startsWith("//")) link.searchParams.set("next", next);
  await sendMail({
    to: e,
    subject: "Your sign-in link for the Control Room",
    text: `Sign in to the Control Room:
${link}

The link works once and expires in 1 hour. If you didn't ask for it, ignore this email.`,
    html: signInEmail(link.toString()),
  });
  return { sent: true };
}

const LOGO = "https://res.cloudinary.com/stratmachine/image/upload/w_96,h_96,c_fit,f_png/v1592332363/machine/icon-512x512_zaffp5.png";

function signInEmail(link: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17171c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;padding:36px">
<tr><td><img src="${LOGO}" width="40" height="40" alt="Strategic Machines" style="border-radius:10px"></td></tr>
<tr><td style="padding-top:24px;font-size:22px;font-weight:600">Sign in to the Control Room</td></tr>
<tr><td style="padding-top:8px;font-size:15px;line-height:1.5;color:#55555f">Click the button to sign in. The link works once and expires in 1 hour.</td></tr>
<tr><td style="padding-top:28px"><a href="${link}" style="display:inline-block;background:#c9a227;color:#17140a;font-weight:600;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:10px">Sign in</a></td></tr>
<tr><td style="padding-top:28px;font-size:13px;line-height:1.5;color:#8a8a94">If you didn't ask for this, ignore this email; nobody can sign in without the link.<br>Strategic Machines · The AI Control Room for your website</td></tr>
</table></td></tr></table></body></html>`;
}
