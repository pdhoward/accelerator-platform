import { z } from "zod";

import { body, fail, json, runnerRoute } from "@/lib/http";
import { finish, type JobResult } from "@/lib/work";

const schema = z.object({
  status: z.enum(["done", "failed"]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(4000).optional(),
  /** The claim this result belongs to; a lapsed, handed-on claim's result is refused (gen2-crew.md §14.1). */
  generation: z.number().int().nonnegative().optional(),
  /** The agent session the job ran in, resumed by the Work item's next job (§17 F4). */
  sessionId: z.string().max(200).optional(),
  /** What the run cost in model spend (the mandate's budget reads it). */
  costUsd: z.number().nonnegative().max(10_000).optional(),
  /** The same spend per model (B20), so the Spend page can split a job: Sonnet reading, Opus reconciling. */
  meter: z.array(z.object({ model: z.string().min(1).max(80), tokensIn: z.number().int().nonnegative(), tokensOut: z.number().int().nonnegative(), costUsd: z.number().nonnegative().max(10_000) })).max(12).optional(),
});

/** The runner reports; lib/work.ts decides what it means for the rail. */
export const POST = runnerRoute<{ jobId: string }>(async ({ request, params }) => {
  const input = await body(request, schema);
  if (!input) return fail("Bad result.", 400);
  await finish(params.jobId, { status: input.status, result: input.result as JobResult | undefined, error: input.error, generation: input.generation, sessionId: input.sessionId, costUsd: input.costUsd, meter: input.meter });
  return json({ ok: true });
});
