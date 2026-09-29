import type { PlatformRole, Role } from "./types";

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

export function canPlatform(role: PlatformRole | null | undefined, action: PlatformAction): boolean {
  return !!role && PLATFORM_PERMISSIONS[role].includes(action);
}

export function canSite(role: Role | null | undefined, action: SiteAction): boolean {
  return !!role && SITE_PERMISSIONS[role].includes(action);
}
