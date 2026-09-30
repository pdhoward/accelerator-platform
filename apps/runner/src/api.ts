import type { JobContext, JobEvent } from "@accelerator/domain";

/**
 * The runner talks only to apps/api (never the database): claim a job,
 * stream events, report the result. The API decides what results mean.
 */
const base = () => (process.env.RUNNER_API_URL ?? process.env.API_URL_LOCAL ?? "http://localhost:4001").replace(/\/$/, "");

async function post<T>(path: string, body: unknown): Promise<T> {
  const token = process.env.RUNNER_TOKEN;
  if (!token) throw new Error("RUNNER_TOKEN is not set.");
  const res = await fetch(`${base()}/api/runner${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error ?? ""}`.trim());
  return data;
}

export const claim = (runnerId: string, version: string) => post<{ context: JobContext | null }>("/claim", { runnerId, version });

/** The site's development keys from the vault, for this running job. */
export const secrets = (jobId: string) => post<{ env: Record<string, string> }>(`/jobs/${jobId}/secrets`, {});

export const finish = (jobId: string, outcome: { status: "done" | "failed"; result?: unknown; error?: string }) => post(`/jobs/${jobId}/finish`, outcome);

type Event = { kind: JobEvent["kind"]; text: string; data?: unknown };

/** The live log: buffered and flushed every second so the Navigator watches it happen. */
export function eventLog(jobId: string) {
  let buffer: Event[] = [];
  let flushing: Promise<unknown> = Promise.resolve();
  const flush = () => {
    if (!buffer.length) return flushing;
    const batch = buffer;
    buffer = [];
    flushing = flushing.then(() => post(`/jobs/${jobId}/events`, { events: batch }).catch((e) => console.error("[events]", e.message)));
    return flushing;
  };
  const timer = setInterval(flush, 1000);
  const add = (kind: Event["kind"], text: string, data?: unknown) => {
    console.log(`  [${kind}] ${text.split("\n")[0]!.slice(0, 160)}`);
    buffer.push({ kind, text, data });
  };
  return {
    log: (text: string) => add("log", text),
    tool: (text: string, data?: unknown) => add("tool", text, data),
    check: (text: string, data?: unknown) => add("check", text, data),
    status: (text: string) => add("status", text),
    async close() {
      clearInterval(timer);
      await flush();
    },
  };
}

export type Log = ReturnType<typeof eventLog>;
