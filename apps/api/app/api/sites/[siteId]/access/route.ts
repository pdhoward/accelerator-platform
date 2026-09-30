import { json, siteRoute } from "@/lib/http";
import { db } from "@/lib/supabase";

/**
 * The caller's footing on this site: role, account, and whether they're
 * Strategic Machines staff. (Suspended accounts never get here: 423.)
 */
export const GET = siteRoute(async ({ caller, site }) => {
  const { data: org } = await db().from("acc_orgs").select("name, status").eq("id", caller.orgId).single();
  return json({
    orgId: caller.orgId,
    orgName: org?.name ?? "Account",
    status: org?.status ?? "active",
    role: caller.role,
    staff: !!caller.staff,
    site: { id: site.id, slug: site.slug, name: site.name, url: site.url },
  });
});
