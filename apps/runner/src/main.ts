import { hostname } from "node:os";

import { claim, eventLog, finish, renew } from "./api";
import { agentSession, buildStep, jobCost, checkout, design, discuss, plan, prove, release } from "./jobs";

/**
 * The Accelerator runner (work/flywheel.md §7). A long-running process:
 * heartbeat + claim a job every couple of seconds, run it, stream the log,
 * report the result. One job at a time.
 *
 *   pnpm --filter @accelerator/runner start
 */
const VERSION = "0.1.0";
const runnerId = `${hostname()}-${process.pid}`;
const JOBS = { discuss, design, plan, build_step: buildStep, checkout, prove, release } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log("\nStopping after the current job (Ctrl+C again to quit now).");
});

console.log(`Accelerator runner ${VERSION} (${runnerId}) → ${process.env.RUNNER_API_URL ?? process.env.API_URL_LOCAL ?? "http://localhost:4001"}`);

while (!stopping) {
  let context;
  try {
    ({ context } = await claim(runnerId, VERSION));
  } catch (err) {
    console.error(`[claim] ${(err as Error).message}`);
    await sleep(5000);
    continue;
  }
  if (!context) {
    await sleep(2000);
    continue;
  }

  const { job } = context;
  console.log(`\n▶ ${job.kind}${context.work ? ` · #${context.work.number} ${context.work.title}` : ""} · ${job.model}`);
  const log = eventLog(job.id);
  const started = Date.now();
  // Keep the claim alive while working (§14.1); if it lapsed and was handed on, this run's result is discarded.
  let superseded = false;
  const renewal = setInterval(() => {
    void renew(job.id, job.generation)
      .then((ok) => {
        if (!ok && !superseded) {
          superseded = true;
          log.status("This job's claim lapsed and was handed on; this run's result will be discarded.");
        }
      })
      .catch((e) => console.error(`[renew] ${(e as Error).message}`));
  }, 60_000);
  try {
    const result = await JOBS[job.kind](context, log);
    log.status(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
    await log.close();
    if (!superseded) await finish(job.id, { status: "done", result, generation: job.generation, sessionId: agentSession(context), costUsd: jobCost(context) });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    log.status(`Failed: ${message}`);
    await log.close();
    if (!superseded) {
      await finish(job.id, { status: "failed", error: message, generation: job.generation, sessionId: agentSession(context), costUsd: jobCost(context) }).catch((e) => console.error(`[finish] ${(e as Error).message}`));
    }
  } finally {
    clearInterval(renewal);
  }
}
