import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { canPlatform, canSite, type Me, type PlatformAction, type SiteAction } from "@accelerator/domain";

import { getMe } from "./api";

/**
 * Role checks for rendering. The API enforces every permission; these only
 * decide what to show, from the same permission maps in packages/domain.
 */

/** Where a signed-in person lands, decided once, here. */
export function homeFor(me: Me): string {
  const open = me.memberships.filter((m) => m.status !== "suspended" && m.status !== "cancelled");
  const sites = open.flatMap((m) => m.sites);
  if (needsMobile(me)) return "/profile/mobile";
  if (me.identity?.platformRole) return "/admin";
  if (sites.length === 1) return `/s/${sites[0]!.slug}`;
  if (sites.length > 1) return "/accounts";
  if (me.memberships.some((m) => m.status === "suspended")) return "/suspended";
  return "/welcome";
}

/** First sign-in isn't finished until the mobile number is verified. */
const needsMobile = (me: Me) => me.mode === "live" && !me.profile?.mobileVerified;

async function readyMe() {
  const me = await getMe();
  if (needsMobile(me)) redirect("/profile/mobile");
  return me;
}

/** The caller's membership for a site slug, or 404. Suspended accounts go to /suspended. */
export const siteAccess = cache(async (slug: string) => {
  const me = await readyMe();
  const membership = me.memberships.find((m) => m.sites.some((s) => s.slug === slug));
  if (!membership) notFound();
  if (membership.status === "suspended") redirect("/suspended");
  return { me, membership, role: membership.role, can: (action: SiteAction) => canSite(membership.role, action) };
});

/** Platform Admin: the caller's platform role, or 404 (the area doesn't exist for others). */
export const platformAccess = cache(async (action: PlatformAction = "platform.view") => {
  const me = await readyMe();
  const role = me.identity?.platformRole ?? null;
  if (!role || !canPlatform(role, action)) notFound();
  return { me, role, can: (a: PlatformAction) => canPlatform(role, a) };
});

export const titleCase = (s: string) => s[0]!.toUpperCase() + s.slice(1);
