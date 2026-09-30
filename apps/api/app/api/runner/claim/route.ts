import { z } from "zod";

import { body, fail, json, runnerRoute } from "@/lib/http";
import { claim, heartbeat } from "@/lib/work";

const schema = z.object({ runnerId: z.string().min(1).max(200), version: z.string().max(40).optional() });

/** Heartbeat + the next job (or null). */
export const POST = runnerRoute(async ({ request }) => {
  const input = await body(request, schema);
  if (!input) return fail("runnerId required.", 400);
  await heartbeat(input.runnerId, input.version);
  return json({ context: await claim(input.runnerId) });
});
