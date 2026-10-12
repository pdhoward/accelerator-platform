import { canPartner } from "./permissions";
import type { AccessVia, PartnerRole, Role } from "./types";

/**
 * How a caller reaches a site (gen2-crew.md §5.3). The API gathers the three
 * facts; this decides, in a fixed order:
 *   1. one of the account's own people → their role
 *   2. the account's partner's team → Operator (never the gates)
 *   3. a live support grant → Operator (never the gates)
 *   4. otherwise no access (the API answers 404)
 */
export type AccessFacts = {
  /** The caller's role as a member of the account, if they are one. */
  memberRole: Role | null;
  /** The caller's role on the team of the account's partner, if they're on it. */
  partnerRole: PartnerRole | null;
  /** Whether the caller holds a live support grant covering the account. */
  supportGrant: boolean;
};

export type SiteAccess = { role: Role; via: AccessVia };

export function resolveSiteAccess(facts: AccessFacts): SiteAccess | null {
  if (facts.memberRole) return { role: facts.memberRole, via: "member" };
  if (canPartner(facts.partnerRole, "clients.operate")) return { role: "operator", via: "partner" };
  if (facts.supportGrant) return { role: "operator", via: "support" };
  return null;
}

/**
 * Only the account's own people hold its gates: approving designs, plans and
 * changes, starting a build, signing the Agreement. Partner and platform
 * staff can discuss and draft.
 */
export const holdsGates = (caller: { via: AccessVia }): boolean => caller.via === "member";

/** Support grants are short: at most three days, and a reason is required. */
export const SUPPORT_GRANT_MAX_HOURS = 72;

export type SupportGrantWindow = { createdAt: Date; expiresAt: Date };

/** The window for a new grant, or an error to show. Hours are clamped to whole hours, 1–72. */
export function supportGrantWindow(hours: number, reason: string, now: Date): SupportGrantWindow | { error: string } {
  if (!reason.trim()) return { error: "Give a reason for the support access." };
  if (!Number.isFinite(hours) || hours < 1) return { error: "Support access lasts at least one hour." };
  const h = Math.min(Math.floor(hours), SUPPORT_GRANT_MAX_HOURS);
  return { createdAt: now, expiresAt: new Date(now.getTime() + h * 3_600_000) };
}

/** A grant is live until it expires or is revoked. */
export function supportGrantLive(grant: { expiresAt: string | Date; revokedAt: string | Date | null }, now: Date): boolean {
  return !grant.revokedAt && new Date(grant.expiresAt).getTime() > now.getTime();
}
