import { supportGrantLive, supportGrantWindow, type Identity, type PartnerRole, type PartnerSeat, type SupportGrant } from "@accelerator/domain";

import { audit } from "./admin";
import { CodeError } from "./codes";
import { db, rows } from "./supabase";

/**
 * Partners (gen2-crew.md §5): the house partner, partner seats on an identity,
 * and support grants, the only way platform staff reach a client outside the
 * house partner. Who-can-do-what lives in packages/domain (permissions.ts,
 * tenancy.ts); this file only reads and writes.
 */

let houseId: string | null = null;

/** The house partner (Strategic Machines Direct). Seeded by migration 0006; cached once found. */
export async function housePartnerId(): Promise<string> {
  if (houseId) return houseId;
  const { data, error } = await db().from("acc_partners").select("id").eq("kind", "house").single();
  if (error || !data) throw new Error("The house partner is missing. Run supabase/migrations/0006_partners.sql.");
  houseId = data.id as string;
  return houseId;
}

/** The partner teams a person sits on (active partners only). */
export async function partnerSeats(userId: string): Promise<PartnerSeat[]> {
  const { data } = await db().from("acc_partner_members").select("partner_id, role, acc_partners(name, status)").eq("user_id", userId);
  return (data ?? []).flatMap((r) => {
    const p = (Array.isArray(r.acc_partners) ? r.acc_partners[0] : r.acc_partners) as { name: string; status: string } | null;
    return p?.status === "active" ? [{ partnerId: r.partner_id as string, partnerName: p.name, role: r.role as PartnerRole }] : [];
  });
}

/** Bootstrap: a platform Owner from PLATFORM_ADMIN_EMAILS also sits on the house partner's team. */
export async function seatOnHousePartner(userId: string, email: string, role: PartnerRole) {
  await db()
    .from("acc_partner_members")
    .upsert({ partner_id: await housePartnerId(), user_id: userId, email, name: email.split("@")[0], role }, { onConflict: "partner_id,email", ignoreDuplicates: true });
}

// ── Support grants ───────────────────────────────────────────────────────────
const toGrant = (r: Record<string, unknown>): SupportGrant => ({
  id: r.id as string,
  grantedToEmail: r.granted_to_email as string,
  orgId: (r.org_id as string | null) ?? null,
  partnerId: (r.partner_id as string | null) ?? null,
  reason: r.reason as string,
  createdAt: r.created_at as string,
  expiresAt: r.expires_at as string,
  revokedAt: (r.revoked_at as string | null) ?? null,
});

/** Whether the person holds a live grant for this company, or for all of its partner's companies. */
export async function hasSupportGrant(userId: string, orgId: string, partnerId: string): Promise<boolean> {
  const { data } = await db()
    .from("acc_support_grants")
    .select("expires_at, revoked_at")
    .eq("granted_to", userId)
    .or(`org_id.eq.${orgId},partner_id.eq.${partnerId}`)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  const now = new Date();
  return (data ?? []).some((g) => supportGrantLive({ expiresAt: g.expires_at as string, revokedAt: g.revoked_at as string | null }, now));
}

/** A platform Owner or Admin grants themselves (or a colleague) time-boxed support access. Audited. */
export async function grantSupport(
  identity: Identity,
  input: { toEmail: string; orgId?: string; partnerId?: string; reason: string; hours: number },
): Promise<SupportGrant> {
  if (!input.orgId === !input.partnerId) throw new CodeError("Grant support on one account or one partner, not both.");
  const window = supportGrantWindow(input.hours, input.reason, new Date());
  if ("error" in window) throw new CodeError(window.error);

  const email = input.toEmail.trim().toLowerCase();
  const [staff] = await rows(db().from("acc_platform_admins").select("user_id").eq("email", email));
  if (!staff) throw new CodeError("Support access is for platform staff. Add them to the team first.");

  const { data, error } = await db()
    .from("acc_support_grants")
    .insert({
      granted_to: staff.user_id,
      granted_to_email: email,
      org_id: input.orgId ?? null,
      partner_id: input.partnerId ?? null,
      reason: input.reason.trim(),
      granted_by: identity.userId,
      created_at: window.createdAt.toISOString(),
      expires_at: window.expiresAt.toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the support grant.");
  const grant = toGrant(data);
  await audit(identity, "support.grant", grant.orgId, { grantId: grant.id, to: email, partnerId: grant.partnerId, reason: grant.reason, expiresAt: grant.expiresAt });
  return grant;
}

export async function revokeSupport(identity: Identity, id: string) {
  const { data, error } = await db().from("acc_support_grants").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("*");
  if (error) throw new Error(error.message);
  const grant = data?.[0];
  if (!grant) throw new CodeError("That grant doesn't exist or is already revoked.");
  await audit(identity, "support.revoke", (grant.org_id as string | null) ?? null, { grantId: id, partnerId: grant.partner_id });
}

/** Grants still live, newest first. */
export async function liveSupportGrants(): Promise<SupportGrant[]> {
  const data = await rows(db().from("acc_support_grants").select("*").is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }));
  return data.map(toGrant);
}
