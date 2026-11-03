import { DOMAINS } from "@accelerator/domain";
import { z } from "zod";

import { demoMode } from "@/lib/auth";
import { alignOpenRulings, cradleHistory, demoAction, demoCradle, demoEvents, demoHistory, fillHole, ingestEvents, readCradle, resolveConflict, restorePolicy, rulePolicy, startCradle } from "@/lib/cradle";
import { body, fail, json, siteRoute } from "@/lib/http";
import { runIngest } from "@/lib/work";

/**
 * Gen 3, the Cradle (gen3-cradle.md): the site's policy book, its findings and
 * readiness, and the ingest run. ?events=<jobId>&after=<id> streams the crew's
 * log for the live ingest view; ?history=1 sends every version, contradiction
 * and decision, for the Graph's time travel. The keyless demo runs the same
 * flow in memory.
 */
export const GET = siteRoute(async ({ request, site }) => {
  const q = new URL(request.url).searchParams;
  const events = q.get("events");
  const history = q.get("history") === "1";
  const after = Number(q.get("after") ?? 0) || 0;
  if (demoMode()) {
    if (!site.demo) return fail("This needs the database.", 503);
    if (history) return json({ history: demoHistory(site) });
    return json(events ? { events: demoEvents(site, after) } : demoCradle(site));
  }
  if (history) return json({ history: await cradleHistory(site) });
  return json(events ? { events: await ingestEvents(site, events, after) } : await readCradle(site));
});

const param = z.union([z.string(), z.number(), z.boolean()]);
const ruling = z.union([
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("dispute"), reason: z.string().min(1) }),
  z.object({ action: z.literal("retire"), reason: z.string().min(1) }),
  z.object({ action: z.literal("set"), parameters: z.record(z.string(), param), reason: z.string().min(1) }),
  z.object({ action: z.literal("restate"), statement: z.string().min(1).max(1000) }),
]);
const schema = z.union([
  z.object({ action: z.literal("start"), pack: z.enum(DOMAINS) }),
  z.object({ action: z.literal("ingest") }),
  z.object({ action: z.literal("rule"), key: z.string().min(1), ruling }),
  z.object({ action: z.literal("resolve"), id: z.string().min(1), ruling: z.string().min(1) }),
  z.object({ action: z.literal("fill"), concept: z.string().min(1), event: z.string().min(1), statement: z.string().min(1).max(1000) }),
  z.object({ action: z.literal("restore"), key: z.string().min(1), version: z.number().int().min(1) }),
  z.object({ action: z.literal("align") }),
  z.object({ action: z.literal("reset") }),
]);

/**
 * Start from a pack, ingest the site's code, rule on a policy, resolve a
 * contradiction or fill a hole. Every decision that changes what the site
 * should do is sent to the crew as a work item ("align" sends rulings made
 * before that existed).
 */
export const POST = siteRoute(async ({ request, identity, caller, site }) => {
  const input = await body(request, schema);
  if (!input) return fail("Start, ingest, rule, resolve or fill.", 400);
  if (demoMode()) {
    if (!site.demo) return fail("This needs the database.", 503);
    demoAction(site, caller.name, input);
    return json(demoCradle(site));
  }
  if (input.action === "reset") return fail("Reset is for the demo only.", 400);
  if (input.action === "start") await startCradle(site, identity, caller.name, input.pack);
  else if (input.action === "ingest") {
    const now = await readCradle(site);
    if (!now.cradle) return fail("Start the cradle before ingesting.", 409);
    await runIngest(site, identity, now.cradle.pack);
  } else if (input.action === "rule") await rulePolicy(site, identity, caller, input.key, input.ruling);
  else if (input.action === "resolve") await resolveConflict(site, identity, caller, input.id, input.ruling);
  else if (input.action === "fill") await fillHole(site, identity, caller, input.concept, input.event, input.statement);
  else if (input.action === "restore") await restorePolicy(site, identity, caller, input.key, input.version);
  else await alignOpenRulings(site, identity, caller);
  return json(await readCradle(site));
}, "config.manage");
