import { fail, json, workRoute } from "@/lib/http";
import { runNextStep } from "@/lib/work";

type P = { siteId: string; number: string };

/** Build the next step of the approved plan (the "Proceed?" answer). */
export const POST = workRoute<P>(async ({ identity, caller, site, params }) => {
  if (caller.staff) return fail("The Navigator decides when to build; Strategic Machines staff can discuss and draft.", 403);
  await runNextStep(site, identity, Number(params.number));
  return json({ ok: true }, 202);
}, "change.approve");
