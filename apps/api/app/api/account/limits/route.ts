import { z } from "zod";

import { resolveCaller } from "@/lib/auth";
import { fail, json } from "@/lib/http";
import { store } from "@/lib/store";

const schema = z.object({
  dailyCapUsd: z.number().min(0).max(10_000).optional(),
  limits: z.array(z.object({ model: z.string(), limitUsd: z.number().min(0).max(100_000) })).max(20).optional(),
});

/** Spend limits per model and a daily cap. The runner refuses work past either. */
export async function PUT(request: Request) {
  const caller = await resolveCaller(request);
  if (caller.role !== "owner" && caller.role !== "operator") return fail("Only the Owner or an Operator can change limits.", 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Limits must be dollar amounts.", 400);
  return json(await store.setLimits(caller.orgId, parsed.data));
}
