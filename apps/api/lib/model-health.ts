import { classifyModelError, modelHealth, redactSecrets, type ModelFault, type ModelHealth, type ModelSuccess, type Site } from "@accelerator/domain";

import { db, rows } from "./supabase";

/**
 * Model health for one site (gen3-cradle.md B18). Three sources, none of them
 * new meters:
 *  - the app's failures: reported over the runtime token, kept as health
 *    snapshots of kind 'model' (migration 0019);
 *  - the app's successes: its metered calls in acc_usage (role app.*);
 *  - the crew: failed jobs whose error is a model-account problem, and
 *    finished jobs as successes.
 */

const LOOKBACK_MS = 7 * 86_400_000;

export type AppFault = { role: string; model: string; status?: number | null; message: string };

/** Record the app's model failures. Ones that aren't model-account problems (our own bugs) are dropped. Returns how many were kept. */
export async function recordAppFaults(site: Pick<Site, "id" | "orgId">, faults: AppFault[]): Promise<number> {
  const kept = faults
    .map((f) => ({ ...f, kind: classifyModelError(f.message, f.status) }))
    .filter((f) => f.kind)
    .map((f) => ({
      org_id: site.orgId, site_id: site.id, kind: "model",
      data: { source: "app", kind: f.kind, role: f.role, model: f.model, status: f.status ?? null, message: redactSecrets(f.message).slice(0, 300) },
    }));
  if (!kept.length) return 0;
  const { error } = await db().from("acc_health_snapshots").insert(kept);
  if (error) throw new Error(/check constraint/i.test(error.message) ? "Model health needs migration 0019 (acc_health_snapshots kind 'model')." : error.message);
  return kept.length;
}

export async function siteModelHealth(site: Pick<Site, "id">): Promise<ModelHealth> {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const [snaps, lastUsage, jobs] = await Promise.all([
    // Before migration 0019 the kind 'model' can't exist yet: an empty list, not an error.
    rows(db().from("acc_health_snapshots").select("data, taken_at").eq("site_id", site.id).eq("kind", "model").gte("taken_at", since).order("taken_at", { ascending: false }).limit(500)).catch(() => []),
    rows(db().from("acc_usage").select("at").eq("site_id", site.id).like("role", "app.%").order("at", { ascending: false }).limit(1)),
    rows(db().from("acc_jobs").select("status, role, model, error, created_at, finished_at").eq("site_id", site.id).in("status", ["done", "failed"]).gte("created_at", since).order("created_at", { ascending: false }).limit(500)),
  ]);

  const faults: ModelFault[] = snaps.map((s) => {
    const d = s.data as { kind: ModelFault["kind"]; role?: string; model?: string; message?: string };
    return { source: "app", kind: d.kind, role: d.role ?? "app", model: d.model ?? "", message: d.message ?? "", at: s.taken_at as string };
  });
  const successes: ModelSuccess[] = lastUsage.map((u) => ({ source: "app", at: u.at as string }));
  for (const j of jobs) {
    const at = (j.finished_at ?? j.created_at) as string;
    if (j.status === "done") successes.push({ source: "crew", at });
    else {
      const kind = classifyModelError(String(j.error ?? ""));
      if (kind) faults.push({ source: "crew", kind, role: j.role as string, model: j.model as string, message: redactSecrets(String(j.error)).slice(0, 300), at });
    }
  }
  return modelHealth({ faults, successes });
}
