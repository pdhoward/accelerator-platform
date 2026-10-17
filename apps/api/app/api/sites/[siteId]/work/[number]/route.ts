import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { holdsGates } from "@accelerator/domain";

import { setAutoShip, setComplexity, workDetail } from "@/lib/work";

type P = { siteId: string; number: string };

export const GET = workRoute<P>(async ({ site, params }) => json(await workDetail(site, Number(params.number))));

const schema = z.union([z.object({ complexity: z.enum(["low", "medium", "high"]) }), z.object({ autoShip: z.boolean() })]);

/**
 * The tier and Medium's standing approval (gen2-crew.md §17). Both decide how
 * much the crew does without asking, so only the account's own people set them.
 */
export const PATCH = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Pick Low, Medium or High.", 400);
  if (!holdsGates(caller)) return fail(`The Navigator decides; ${caller.partnerName ?? "partner"} staff can discuss and draft.`, 403);
  const n = Number(params.number);
  if ("complexity" in input) await setComplexity(site, identity, caller.name, n, input.complexity);
  else await setAutoShip(site, identity, caller.name, n, input.autoShip);
  return json({ ok: true });
}, "change.approve");
