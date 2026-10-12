import type { Log } from "./api";

/**
 * Vercel deploys every pushed branch and records each deployment on the
 * commit in GitHub (environment "Preview…" or "Production…"). The runner
 * reads those records, so it needs no Vercel key: a GitHub token is enough,
 * and a public repository needs none (at a lower rate limit).
 */
const GH = "https://api.github.com";
const DONE = ["success", "failure", "error", "inactive"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const headers = (token?: string): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "user-agent": "accelerator-runner",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export type Deployment = { state: string; url: string | null; environment: string | null };

/** Wait for the deployment of `sha` to finish. "missing" if none appears before the timeout. */
export async function waitForDeployment(
  repo: string,
  sha: string,
  target: "preview" | "production",
  log: Log,
  token?: string,
  timeoutMs = 10 * 60_000,
): Promise<Deployment> {
  const deadline = Date.now() + timeoutMs;
  const every = token ? 10_000 : 30_000; // unauthenticated GitHub allows 60 requests an hour
  let seen: string | null = null;
  while (Date.now() < deadline) {
    const r = await fetch(`${GH}/repos/${repo}/deployments?sha=${sha}&per_page=20`, { headers: headers(token) }).catch(() => null);
    if (r?.ok) {
      const list = (await r.json()) as { id: number; environment: string }[];
      const d = list.find((x) => (target === "production") === /^production/i.test(x.environment));
      if (d) {
        if (seen !== d.environment) log.status(`Vercel is deploying (${d.environment})…`);
        seen = d.environment;
        const s = await fetch(`${GH}/repos/${repo}/deployments/${d.id}/statuses?per_page=1`, { headers: headers(token) }).catch(() => null);
        const [latest] = s?.ok ? ((await s.json()) as { state: string; environment_url?: string; target_url?: string }[]) : [];
        if (latest && DONE.includes(latest.state)) {
          // "inactive": a newer deployment of the same branch replaced it after it succeeded.
          const state = latest.state === "inactive" ? "success" : latest.state;
          return { state, url: latest.environment_url || latest.target_url || null, environment: d.environment };
        }
      }
    } else if (r && (r.status === 403 || r.status === 429)) {
      log.status("GitHub's rate limit; waiting…");
    }
    await sleep(every);
  }
  return { state: "missing", url: null, environment: seen };
}

/** The HTTP status a page answers with, or null if it can't be reached. 401/403 on a preview: Vercel protection. */
export async function probe(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    return r.status;
  } catch {
    return null;
  }
}
