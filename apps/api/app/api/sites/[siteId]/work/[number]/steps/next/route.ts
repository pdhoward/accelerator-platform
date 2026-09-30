import { json, workRoute } from "@/lib/http";
import { runNextStep } from "@/lib/work";

type P = { siteId: string; number: string };

/** Build the next step of the approved plan (the "Proceed?" answer). */
export const POST = workRoute<P>(async ({ identity, site, params }) => {
  await runNextStep(site, identity, Number(params.number));
  return json({ ok: true }, 202);
}, "change.approve");
