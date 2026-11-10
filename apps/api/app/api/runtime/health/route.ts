import { z } from "zod";

import { demoMode } from "@/lib/auth";
import { body, fail, json, publicRoute } from "@/lib/http";
import { recordAppFaults } from "@/lib/model-health";
import { siteForToken } from "@/lib/runtime";

/**
 * POST /api/runtime/health — a running app reports that a model call failed
 * (B18), so the site's Health page and Policy dial show "AI unavailable" with
 * the fix. The platform classifies each message itself and keeps only
 * model-account problems (credit, key, model name, rate limit, overload,
 * outage). Bearer: the site's runtime token.
 */
const schema = z.object({
  faults: z.array(z.object({
    role: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
    model: z.string().min(1).max(80),
    status: z.number().int().min(0).max(999).nullable().optional(),
    message: z.string().min(1).max(1000),
  })).min(1).max(20),
});

export const POST = publicRoute(async ({ request }) => {
  if (demoMode()) return fail("Model health needs the database.", 503);
  const site = await siteForToken(request);
  if (!site) return fail("Not a runtime token for any site.", 401);
  const input = await body(request, schema);
  if (!input) return fail("Send { faults: [{ role, model, status?, message }] }.", 400);
  return json({ recorded: await recordAppFaults(site, input.faults) });
});
