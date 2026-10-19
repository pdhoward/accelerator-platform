import { holdsGates } from "@accelerator/domain";
import { z } from "zod";

import { body, fail, json, workRoute } from "@/lib/http";
import { saveVoiceTranscript } from "@/lib/voice";

type P = { siteId: string; number: string };

const schema = z.object({
  lines: z.array(z.object({ speaker: z.enum(["person", "lead"]), text: z.string().max(4000), at: z.number() })).max(400),
  startedAt: z.number(),
  endedAt: z.number(),
});

/** Save a finished call's transcript into the item's conversation, so voice and text share one record. */
export const POST = workRoute<P>(async ({ request, identity, caller, site, params }) => {
  const input = await body(request, schema);
  if (!input || input.endedAt < input.startedAt) return fail("Check the transcript.", 400);
  await saveVoiceTranscript(site, identity, { name: caller.name, role: caller.role, member: holdsGates(caller) }, Number(params.number), input.lines, input.startedAt, input.endedAt);
  return json({ ok: true }, 201);
}, "request.create");
