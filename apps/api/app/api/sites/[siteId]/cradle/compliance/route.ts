import { z } from "zod";

import { body, fail, json, siteRoute } from "@/lib/http";
import { compliance, setScenarioStatus } from "@/lib/proof";

/** The conformance gate for the steward (B5): what is in force, the newest proof, and every scenario; approve or retire one. */
export const GET = siteRoute(async ({ site }) => json((await compliance(site)) ?? { live: null, inForce: null, proof: null, scenarios: [] }));

const schema = z.object({ id: z.string().regex(/^SCN-\d+$/), status: z.enum(["approved", "retired", "draft"]) });

export const POST = siteRoute(async ({ request, site, caller }) => {
  const input = await body(request, schema);
  if (!input) return fail("Which scenario, and approve or retire?", 400);
  await setScenarioStatus(site, input.id, input.status, caller.name);
  return json((await compliance(site))!);
}, "config.manage");
