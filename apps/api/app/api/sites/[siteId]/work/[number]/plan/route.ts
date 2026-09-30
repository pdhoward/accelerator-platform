import { canSite } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { approvePlan, draftPlan } from "@/lib/work";

type P = { siteId: string; number: string };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), note: z.string().max(4000).optional() }),
  z.object({ action: z.literal("approve") }),
]);

/** The plan: ask the engine to write/revise it, or approve it (gate 2). */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown plan action.", 400);
  const n = Number(params.number);
  if (input.action === "draft") await draftPlan(site, identity, n, input.note);
  else {
    if (!canSite(caller.role, "change.approve")) return fail("Your role can't approve plans.", 403);
    await approvePlan(site, identity, caller.name, n);
  }
  return json({ ok: true });
}, "request.create");
