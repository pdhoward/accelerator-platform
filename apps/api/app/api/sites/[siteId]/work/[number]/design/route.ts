import { canSite } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { approveDesign, draftDesign, saveDesign } from "@/lib/work";

type P = { siteId: string; number: string };

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("draft"), note: z.string().max(4000).optional() }),
  z.object({ action: z.literal("save"), body: z.string().trim().min(10).max(100_000) }),
  z.object({ action: z.literal("approve"), version: z.number().int().positive() }),
]);

/** design.md: ask the engine to draft/revise it, save your edits, or approve a version (gate 1). */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown design action.", 400);
  const n = Number(params.number);
  if (input.action === "draft") await draftDesign(site, identity, n, input.note);
  else if (input.action === "save") await saveDesign(site, identity, caller.name, n, input.body);
  else {
    if (!canSite(caller.role, "change.approve")) return fail("Your role can't approve designs.", 403);
    if (caller.staff) return fail("The Navigator approves; Strategic Machines staff can discuss and draft.", 403);
    await approveDesign(site, identity, caller.name, n, input.version);
  }
  return json({ ok: true });
}, "request.create");
