import { z } from "zod";

import { demoMode } from "@/lib/auth";
import { body, fail, json, publicRoute } from "@/lib/http";
import { saveProjection } from "@/lib/proof";
import { siteForToken } from "@/lib/runtime";

/**
 * POST /api/runtime/projection: a running app stores a book version it has
 * compiled into its runtime settings (B11), so its other servers read it
 * instead of compiling again (about 6 s and 2 cents each time). Bearer: the
 * site's runtime token. The settings are the app's own; the conformance gate
 * still proves every version before it serves.
 */
const schema = z.object({
  version: z.string().regex(/^[0-9a-f]{8}$/),
  schema: z.string().regex(/^[0-9a-f]{8}$/),
  projection: z.record(z.string(), z.unknown()).refine((p) => JSON.stringify(p).length <= 64_000, "Settings over 64 KB"),
  model: z.string().min(1).max(80),
  costUsd: z.number().nonnegative().max(100),
});

export const POST = publicRoute(async ({ request }) => {
  if (demoMode()) return fail("Stored settings need the database.", 503);
  const site = await siteForToken(request);
  if (!site) return fail("Not a runtime token for any site.", 401);
  const input = await body(request, schema);
  if (!input) return fail("Send { version, schema, projection, model, costUsd }.", 400);
  const result = await saveProjection(site, input);
  if (result === "unknown version") return fail("That isn't the live version or the one in force.", 409);
  return json({ ok: true, result });
});
