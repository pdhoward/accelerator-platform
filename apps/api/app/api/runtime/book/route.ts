import { runtimeBook, type Site } from "@accelerator/domain";

import { demoMode } from "@/lib/auth";
import { readCradle } from "@/lib/cradle";
import { fail, json, publicRoute } from "@/lib/http";
import { verifyRuntimeToken } from "@/lib/runtime";
import { db, rows } from "@/lib/supabase";

/**
 * GET /api/runtime/book — a running app reads its own policy book (backlog
 * B4). Bearer: the site's runtime token (Policy → "Run the app on this
 * book"). Read-only, one site, the rules in force right now.
 */
export const GET = publicRoute(async ({ request }) => {
  if (demoMode()) return fail("The runtime book needs the database.", 503);
  const siteId = verifyRuntimeToken(request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]);
  if (!siteId) return fail("Not a runtime token for any site.", 401);
  const [s] = await rows(db().from("acc_sites").select("id, org_id, name, slug").eq("id", siteId));
  if (!s) return fail("Site not found.", 404);
  const site = { id: s.id as string, orgId: s.org_id as string, name: s.name as string, slug: s.slug as string } as Site;
  const r = await readCradle(site);
  if (!r.cradle) return fail("This site has no cradle yet.", 404);
  const res = json(runtimeBook(r, { id: site.id, name: site.name }));
  res.headers.set("Cache-Control", "no-store");
  return res;
});
