import { holdsGates } from "@accelerator/domain";

import { fail, json, workRoute } from "@/lib/http";
import { runNextStep } from "@/lib/work";

type P = { siteId: string; number: string };

/** Run a step the Protocol blocked again. Steps otherwise run on their own. */
export const POST = workRoute<P>(async ({ identity, caller, site, params }) => {
  if (!holdsGates(caller)) return fail(`The Navigator decides when to build; ${caller.partnerName ?? "partner"} staff can discuss and draft.`, 403);
  await runNextStep(site, identity, Number(params.number));
  return json({ ok: true }, 202);
}, "change.approve");
