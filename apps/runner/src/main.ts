import { hostname } from "node:os";

import { claim, eventLog, finish } from "./api";
import { buildStep, checkout, design, discuss, plan } from "./jobs";

/**
 * The Accelerator runner (work/flywheel.md §7). A long-running process:
 * heartbeat + claim a job every couple of seconds, run it, stream the log,
 * report the result. One job at a time.
 *
 *   pnpm --filter @accelerator/runner start
 */
const VERSION = "0.1.0";
const runnerId = `${hostname()}-${process.pid}`;
const JOBS = { discuss, design, plan, build_step: buildStep, checkout } as const;
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
  try {
    const result = await JOBS[job.kind](context, log);
    log.status(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
    await log.close();
    await finish(job.id, { status: "done", result });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    log.status(`Failed: ${message}`);
    await log.close();
    await finish(job.id, { status: "failed", error: message }).catch((e) => console.error(`[finish] ${(e as Error).message}`));
  }
}
