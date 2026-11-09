import { z } from "zod";

import { demoMode } from "@/lib/auth";
import { body, fail, json, publicRoute } from "@/lib/http";
import { siteForToken } from "@/lib/runtime";
import { recordAppUsage } from "@/lib/spend";

/**
 * POST /api/runtime/usage — a running app reports its own model calls
 * (searches, rule compiles, the assistant) so the site's spend scorecard can
 * show which work costs the money. Bearer: the site's runtime token.
 */
const schema = z.object({
  events: z.array(z.object({
    role: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    model: z.string().min(1).max(80),
    tokensIn: z.number().int().min(0).max(5_000_000),
    tokensOut: z.number().int().min(0).max(1_000_000),
    costUsd: z.number().min(0).max(100),
  })).min(1).max(50),
});

export const POST = publicRoute(async ({ request }) => {
  if (demoMode()) return fail("Usage needs the database.", 503);
  const site = await siteForToken(request);
  if (!site) return fail("Not a runtime token for any site.", 401);
  const input = await body(request, schema);
  if (!input) return fail("Send { events: [{ role, model, tokensIn, tokensOut, costUsd }] }.", 400);
  return json({ recorded: await recordAppUsage(site, input.events) });
});
