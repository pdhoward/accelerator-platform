import { NextResponse } from "next/server";
import type { Caller, Site } from "@accelerator/domain";

import { resolveCaller } from "./auth";
import { store } from "./store";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

type SiteParams = { params: Promise<{ siteId: string }> };

/**
 * Wraps a site-scoped route: resolves the caller, then loads the site only if
 * it belongs to the caller's org. A site from another tenant is a 404, not a
 * 403 — its existence isn't disclosed.
 */
export function siteRoute<P extends SiteParams>(
  handler: (ctx: { request: Request; caller: Caller; site: Site; params: Awaited<P["params"]> }) => Promise<Response> | Response,
) {
  return async (request: Request, context: P) => {
    const params = (await context.params) as Awaited<P["params"]>;
    try {
      const caller = await resolveCaller(request);
      const site = await store.site(caller.orgId, params.siteId);
      if (!site) return fail("Site not found.", 404);
      return await handler({ request, caller, site, params });
    } catch (err) {
      console.error(err);
      return fail("Something went wrong on our side.", 500);
    }
  };
}
