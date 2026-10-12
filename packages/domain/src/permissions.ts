import type { PartnerRole, PlatformRole, Role } from "./types";

/**
 * Who can do what — the ONE place to change it (work/accounts-auth-admin.md §3).
 * The API enforces these (403) and the console hides what a role can't use.
 * Gate policy (gates.ts) still adds: money/data/auth/security need the Owner.
 */

// ── Platform (the Platform Admin area, across all accounts) ────────────────
export const PLATFORM_ACTIONS = [
  "platform.view", // overview, accounts, health
  "revenue.view", // revenue and billing figures
  "accounts.manage", // create accounts, invite, edit plan / billing mode
  "accounts.suspend", // suspend / resume
  "audit.view",
  "team.manage", // platform staff
  "support.grant", // time-boxed, audited access to a partner's client (gen2-crew.md §5)
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export const PLATFORM_PERMISSIONS: Record<PlatformRole, readonly PlatformAction[]> = {
  owner: PLATFORM_ACTIONS,
  admin: PLATFORM_ACTIONS.filter((a) => a !== "team.manage"),
  staff: ["platform.view"],
};

// ── Customer (the Control Room, per account) ────────────────────────────────
export const SITE_ACTIONS = [
  "site.view",
  "request.create",
  "change.approve", // try + approve (non-money)
  "release.ship", // Go live to production
  "skills.manage",
  "limits.manage",
  "config.manage",
  "members.manage",
  "billing.manage",
] as const;
export type SiteAction = (typeof SITE_ACTIONS)[number];

export const SITE_PERMISSIONS: Record<Role, readonly SiteAction[]> = {
  owner: SITE_ACTIONS,
  operator: SITE_ACTIONS.filter((a) => a !== "members.manage" && a !== "billing.manage"),
  tester: ["site.view", "request.create", "change.approve"],
  viewer: ["site.view"],
};

// ── Partner (a partner firm's team, across its client accounts) ────────────
export const PARTNER_ACTIONS = [
  "partner.view",
  "clients.create", // new client accounts under this partner
  "clients.operate", // Operator rights on every client site of this partner (never the gates)
  "skills.manage", // partner skills
  "brand.manage", // how the partner's crews look to its clients
  "billing.view",
  "team.manage", // the partner's own team
] as const;
export type PartnerAction = (typeof PARTNER_ACTIONS)[number];

export const PARTNER_PERMISSIONS: Record<PartnerRole, readonly PartnerAction[]> = {
  owner: PARTNER_ACTIONS,
  admin: PARTNER_ACTIONS.filter((a) => a !== "team.manage"),
  operator: ["partner.view", "clients.operate"],
};

export function canPartner(role: PartnerRole | null | undefined, action: PartnerAction): boolean {
  return !!role && PARTNER_PERMISSIONS[role].includes(action);
}

export function canPlatform(role: PlatformRole | null | undefined, action: PlatformAction): boolean {
  return !!role && PLATFORM_PERMISSIONS[role].includes(action);
}

export function canSite(role: Role | null | undefined, action: SiteAction): boolean {
  return !!role && SITE_PERMISSIONS[role].includes(action);
}
