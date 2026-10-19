import { holdsGates, isVoiceTool } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { runVoiceTool } from "@/lib/voice";

type P = { siteId: string; number: string };

const schema = z.object({ name: z.string().max(60), arguments: z.string().max(8000).default("{}") });

/** Run a tool the lead called on a live call, with the caller's own authority (gen2-crew.md §19.1). */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Unknown tool call.", 400);
  if (!isVoiceTool(input.name)) return json({ output: JSON.stringify({ error: `There's no tool called ${input.name}.` }) });
  const output = await runVoiceTool(site, identity, { name: caller.name, role: caller.role, member: holdsGates(caller) }, Number(params.number), input.name, input.arguments);
  return json({ output });
}, "request.create");
