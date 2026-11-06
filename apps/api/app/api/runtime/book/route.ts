import { demoMode } from "@/lib/auth";
import { fail, json, publicRoute } from "@/lib/http";
import { runtimeResponse } from "@/lib/proof";
import { siteForToken } from "@/lib/runtime";

/**
 * GET /api/runtime/book — a running app reads its own policy book (backlog
 * B4): the live rules, the version in force (the last that passed the
 * conformance gate, B5), the scenarios that prove it, and the newest proof.
 * Bearer: the site's runtime token. Read-only, one site.
 */
export const GET = publicRoute(async ({ request }) => {
  if (demoMode()) return fail("The runtime book needs the database.", 503);
  const site = await siteForToken(request);
  if (!site) return fail("Not a runtime token for any site.", 401);
  const res = await runtimeResponse(site);
  if (!res) return fail("This site has no cradle yet.", 404);
  const out = json(res);
  out.headers.set("Cache-Control", "no-store");
  return out;
});
