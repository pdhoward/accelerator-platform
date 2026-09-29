import { z } from "zod";

import { body, fail, json, siteRoute } from "@/lib/http";
import { store } from "@/lib/store";

const schema = z.object({
  dailyCapUsd: z.number().min(0).max(10_000).optional(),
  limits: z.array(z.object({ model: z.string(), limitUsd: z.number().min(0).max(100_000) })).max(20).optional(),
});

/** Spend limits per model and a daily cap. The runner refuses work past either. */
export const PUT = siteRoute(async ({ request, caller }) => {
  const input = await body(request, schema);
  if (!input) return fail("Limits must be dollar amounts.", 400);
  return json(await store.setLimits(caller.orgId, input));
}, "limits.manage");
