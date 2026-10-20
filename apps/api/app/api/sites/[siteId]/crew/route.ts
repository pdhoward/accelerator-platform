import { holdsGates } from "@accelerator/domain";
import { z } from "zod";

import { readCrew, saveCrew } from "@/lib/crew";
import { body, fail, json, workRoute } from "@/lib/http";

/** The site's crew (gen2-crew.md §2, G2.3): who is on it, what each may use and know, and its versions. */
export const GET = workRoute(async ({ site }) => json(await readCrew(site)));

const schema = z.object({
  config: z.object({ tools: z.record(z.string(), z.array(z.string())).optional(), disabledSkills: z.array(z.string()).optional() }),
  note: z.string().max(300).optional(),
});

/** A new crew version. Clients approve rather than assemble, so this is the operator's (and the Owner's) change. */
export const POST = workRoute(async ({ request, identity, caller, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Send the crew settings.", 400);
  const saved = await saveCrew(site, identity, caller.name + (holdsGates(caller) ? "" : ` (${caller.partnerName ?? "partner"})`), input.config, input.note);
  return json(saved);
}, "config.manage");
