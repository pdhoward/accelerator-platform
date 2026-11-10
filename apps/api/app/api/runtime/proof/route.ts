import { z } from "zod";

import { demoMode } from "@/lib/auth";
import { body, fail, json, publicRoute } from "@/lib/http";
import { addScenarios, blockProof, finishProof, startProof } from "@/lib/proof";
import { siteForToken } from "@/lib/runtime";

/**
 * POST /api/runtime/proof — the app reports on the conformance gate (B5):
 * start proving a book version, add the scenarios the crew drafted, and
 * finish with the results. A pass on the live version puts it in force.
 */
const check = z.union([
  z.object({ kind: z.literal("buy"), product: z.object({ price: z.number().nullable(), currency: z.string(), stock: z.enum(["in", "out", "unknown"]) }), expect: z.boolean() }),
  z.object({ kind: z.literal("search"), request: z.string().min(1).max(300), expect: z.object({ noOutOfStock: z.boolean(), maxPrice: z.number().nullable(), minResults: z.number().int().min(0) }) }),
  z.object({ kind: z.literal("assistant"), message: z.string().min(1).max(500), expect: z.object({ mustCall: z.array(z.string()), mustNotCall: z.array(z.string()), replyMust: z.string() }) }),
  z.object({ kind: z.literal("notice"), field: z.enum(["productPage", "footer", "orderTestMode", "orderLiveMode"]), must: z.string().min(1).max(500) }),
]);
const scenario = z.object({
  title: z.string().min(1).max(200), policies: z.array(z.string()).max(20), criticality: z.enum(["critical", "important", "routine"]),
  given: z.string().max(500), when: z.string().max(500), then: z.string().max(500), check, source: z.enum(["example", "ruling", "crew"]),
});
const result = z.object({ id: z.string(), passed: z.boolean(), runs: z.number().int(), passes: z.number().int(), detail: z.string().max(1000), ms: z.number() });
const schema = z.union([
  z.object({ action: z.literal("start"), version: z.string().min(1).max(32) }),
  z.object({ action: z.literal("scenarios"), drafts: z.array(scenario).max(20) }),
  z.object({ action: z.literal("finish"), version: z.string().min(1).max(32), results: z.array(result).max(200), costUsd: z.number().min(0) }),
  // The app couldn't reach its model (B18): stop without a verdict.
  z.object({ action: z.literal("blocked"), version: z.string().min(1).max(32), reason: z.string().min(1).max(200) }),
]);

export const POST = publicRoute(async ({ request }) => {
  if (demoMode()) return fail("The conformance gate needs the database.", 503);
  const site = await siteForToken(request);
  if (!site) return fail("Not a runtime token for any site.", 401);
  const input = await body(request, schema);
  if (!input) return fail("Start, scenarios, finish or blocked.", 400);
  if (input.action === "blocked") {
    await blockProof(site, input.version, input.reason);
    return json({ ok: true });
  }
  if (input.action === "start") return (await startProof(site, input.version)) ? json({ ok: true }) : fail("Already proven or being proven.", 409);
  if (input.action === "scenarios") return json({ added: await addScenarios(site, input.drafts) });
  return json(await finishProof(site, input.version, input.results, input.costUsd));
});
