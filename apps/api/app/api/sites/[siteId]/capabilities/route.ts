import { z } from "zod";

import { addCapability, readCapabilities, surveyCapabilities } from "@/lib/capabilities";
import { body, fail, json, workRoute } from "@/lib/http";

/** The capability inventory (gen2-crew.md §10.3, G2.3a): capabilities, condition, progress and the scorecard. */
export const GET = workRoute(async ({ site }) => json(await readCapabilities(site)));

const schema = z.union([z.object({ action: z.literal("survey") }), z.object({ action: z.literal("add"), values: z.record(z.string(), z.unknown()) })]);

/** Run the Surveyor's pass over the repository, or add a capability by hand. */
export const POST = workRoute(async ({ request, identity, caller, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Survey or add.", 400);
  if (input.action === "survey") return json(await surveyCapabilities(site, identity, caller.name));
  return json(await addCapability(site, identity, caller.name, input.values));
}, "config.manage");
