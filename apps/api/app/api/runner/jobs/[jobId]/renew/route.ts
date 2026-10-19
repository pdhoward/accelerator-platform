import { z } from "zod";

import { body, fail, json, runnerRoute } from "@/lib/http";
import { renewClaim } from "@/lib/work";

const schema = z.object({ generation: z.number().int().nonnegative() });

/** The runner renews its claim while it works (gen2-crew.md §14.1); 409 means the claim lapsed or was handed on. */
export const POST = runnerRoute<{ jobId: string }>(async ({ request, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Bad renewal.", 400);
  return (await renewClaim(params.jobId, input.generation)) ? json({ ok: true }) : fail("This claim lapsed or was handed to another worker.", 409);
});
