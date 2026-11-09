import { spendScorecard, type Site, type SpendJob, type SpendProof, type SpendScorecard, type SpendUsage } from "@accelerator/domain";

import { db, rows } from "./supabase";

/**
 * The spend scorecard's sources for one site (see packages/domain/src/spend.ts):
 * the crew's jobs (acc_jobs.cost_usd), the running app's own model calls
 * (acc_usage, reported over the runtime token), and the gate's proof runs.
 */
export async function siteSpend(site: Pick<Site, "id">, days: number): Promise<SpendScorecard> {
  const since = new Date(Date.now() - (days + 1) * 86_400_000).toISOString();
  const [jobRows, usageRows, proofRows] = await Promise.all([
    rows(db().from("acc_jobs").select("id, kind, model, cost_usd, created_at, status, work_id").eq("site_id", site.id).gte("created_at", since).limit(5000)),
    rows(db().from("acc_usage").select("role, model, tokens_in, tokens_out, cost_usd, at").eq("site_id", site.id).gte("at", since).limit(20000)),
    rows(db().from("acc_cradle_nodes").select("body").eq("site_id", site.id).eq("kind", "decision").like("key", "PROOF-%").gte("created_at", since)),
  ]);

  const workIds = [...new Set(jobRows.map((j) => j.work_id as string | null).filter((x): x is string => !!x))];
  const work = workIds.length ? await rows(db().from("acc_work").select("id, number, title").in("id", workIds)) : [];
  const byWork = new Map(work.map((w) => [w.id as string, w]));

  const jobs: SpendJob[] = jobRows.map((j) => {
    const w = j.work_id ? byWork.get(j.work_id as string) : undefined;
    return {
      id: j.id as string, kind: j.kind as string, model: j.model as string, at: j.created_at as string, status: j.status as string,
      costUsd: j.cost_usd == null ? null : Number(j.cost_usd),
      workNumber: w ? Number(w.number) : null, title: w ? (w.title as string) : null,
    };
  });
  const usage: SpendUsage[] = usageRows.map((u) => ({
    role: String(u.role).replace(/^app\./, ""), model: u.model as string, tokensIn: Number(u.tokens_in), tokensOut: Number(u.tokens_out), costUsd: Number(u.cost_usd), at: u.at as string,
  }));
  const proofs: SpendProof[] = proofRows
    .map((r) => r.body as { bookVersion?: string; at?: string; costUsd?: number; status?: string })
    .filter((b) => b && (b.status === "passed" || b.status === "failed") && typeof b.at === "string")
    .map((b) => ({ version: b.bookVersion ?? "", at: b.at!, costUsd: Number(b.costUsd) || 0, status: b.status! }));

  return spendScorecard({ jobs, usage, proofs, days });
}

/** Stamped with the server's time on arrival: the app reports right after each call. */
export type AppUsage = { role: string; model: string; tokensIn: number; tokensOut: number; costUsd: number };

/** The running app reports its own model calls (searches, compiles, the assistant). */
export async function recordAppUsage(site: Pick<Site, "id" | "orgId">, events: AppUsage[]) {
  if (!events.length) return 0;
  const provider = (model: string) => (model.startsWith("claude") ? "anthropic" : model.startsWith("gpt") || model.startsWith("o") ? "openai" : "other");
  const { error } = await db().from("acc_usage").insert(
    events.map((e) => ({
      org_id: site.orgId, site_id: site.id, provider: provider(e.model), model: e.model, role: `app.${e.role}`,
      tokens_in: Math.round(e.tokensIn), tokens_out: Math.round(e.tokensOut), cost_usd: Math.round(e.costUsd * 10000) / 10000,
    })),
  );
  if (error) throw new Error(error.message);
  return events.length;
}
