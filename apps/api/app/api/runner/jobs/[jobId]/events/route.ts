import { z } from "zod";

import { body, fail, json, runnerRoute } from "@/lib/http";
import { addEvents } from "@/lib/work";

const schema = z.object({
  events: z.array(z.object({ kind: z.enum(["log", "tool", "check", "status"]), text: z.string().max(8000), data: z.unknown().optional() })).max(200),
});

/** The live log the Navigator watches. */
export const POST = runnerRoute<{ jobId: string }>(async ({ request, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Bad events.", 400);
  await addEvents(params.jobId, input.events);
  return json({ ok: true });
});
