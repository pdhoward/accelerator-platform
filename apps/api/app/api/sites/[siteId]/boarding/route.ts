import { holdsGates } from "@accelerator/domain";
import { z } from "zod";

import { demoMode } from "@/lib/auth";
import { logIntervention, readBoarding } from "@/lib/boarding";
import { body, fail, json, siteRoute, workRoute } from "@/lib/http";
import { saveInterview, siteInterview } from "@/lib/library";
import { boardingSample } from "@/lib/studio-sample";

/** Boarding (gen2-crew.md §2.5, G2.6): each step's state from the records, the interview and the interventions log. The keyless demo shows Machine Shop's sample. */
export const GET = siteRoute(async ({ site }) =>
  demoMode()
    ? site.demo ? json({ ...boardingSample(new Date().toISOString()), sample: true }) : fail("This needs the database.", 503)
    : json({ ...(await readBoarding(site)), interview: await siteInterview(site.id) }),
);

const schema = z.union([
  z.object({ action: z.literal("interview"), values: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("intervention"), step: z.string(), note: z.string().max(500) }),
]);

export const POST = workRoute(async ({ request, identity, caller, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown action.", 400);
  if (input.action === "interview") {
    if (!holdsGates(caller)) return fail("The client answers the interview; partner staff can prepare it in the conversation.", 403);
    return json(await saveInterview(site, identity, caller.name, input.values));
  }
  await logIntervention(site, identity, caller.name, input.step, input.note);
  return json({ ok: true });
}, "request.create");
