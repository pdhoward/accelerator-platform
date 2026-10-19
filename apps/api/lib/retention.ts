import { gzipSync } from "node:zlib";
import { archivesToDelete, DEFAULT_RETENTION, draftsToPrune, logsToArchive, type RetentionSettings } from "@accelerator/domain";

import { record } from "./ledger";
import { db, rows, type Row } from "./supabase";

/**
 * Retention (gen2-crew.md §21.4, traceability T4), run nightly by Supabase
 * (pg_cron calling /api/cron/retention, migration 0011). Per company: job logs older than the hot window move to compressed
 * archives in private storage; archives past retention are deleted; draft
 * document versions beyond `drafts_kept` are pruned. Anything approved,
 * current or referenced by a decision is never touched, and every pruning is
 * recorded in the ledger. Bounded per run so one call can't run long.
 */

export const LOG_BUCKET = "accelerator-logs";
const JOBS_PER_RUN = 40;

export type RetentionReport = { archived: number; deletedArchives: number; prunedDrafts: number; errors: string[] };

const settingsFor = (r: Row | undefined): RetentionSettings =>
  r
    ? { draftsKept: r.drafts_kept as number, logsHotDays: r.logs_hot_days as number, logsRetentionDays: r.logs_retention_days as number, artifactsRetentionDays: r.artifacts_retention_days as number }
    : DEFAULT_RETENTION;

export async function runRetention(now = Date.now()): Promise<RetentionReport> {
  const report: RetentionReport = { archived: 0, deletedArchives: 0, prunedDrafts: 0, errors: [] };
  const [orgs, saved] = await Promise.all([rows(db().from("acc_orgs").select("id")), rows(db().from("acc_retention").select("*"))]);
  const byOrg = new Map(saved.map((r) => [r.org_id as string, r]));
  for (const org of orgs) {
    const settings = settingsFor(byOrg.get(org.id as string));
    try {
      report.archived += await archiveLogs(org.id as string, settings, now);
      report.deletedArchives += await deleteExpiredArchives(org.id as string, settings, now);
      report.prunedDrafts += await pruneDrafts(org.id as string, settings);
    } catch (err) {
      report.errors.push(`${org.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}

async function archiveLogs(orgId: string, settings: RetentionSettings, now: number): Promise<number> {
  const cutoff = new Date(now - settings.logsHotDays * 86_400_000).toISOString();
  const finished = await rows(db().from("acc_jobs").select("id, site_id, finished_at").eq("org_id", orgId).in("status", ["done", "failed", "cancelled"]).lt("finished_at", cutoff).order("finished_at").limit(JOBS_PER_RUN * 3));
  if (!finished.length) return 0;
  const archived = new Set((await rows(db().from("acc_log_archives").select("job_id").in("job_id", finished.map((j) => j.id as string)))).map((a) => a.job_id as string));
  const due = logsToArchive(finished.map((j) => ({ id: j.id as string, finishedAt: j.finished_at as string, archived: archived.has(j.id as string) })), settings, now).slice(0, JOBS_PER_RUN);
  let count = 0;
  for (const job of due) {
    const siteId = finished.find((j) => j.id === job.id)!.site_id as string;
    const events = await rows(db().from("acc_job_events").select("id, at, kind, text, data").eq("job_id", job.id).order("id").limit(20_000));
    if (!events.length) {
      await db().from("acc_log_archives").insert({ org_id: orgId, site_id: siteId, job_id: job.id, storage_key: "", events: 0, bytes: 0 });
      continue;
    }
    const body = gzipSync(Buffer.from(events.map((e) => JSON.stringify(e)).join("\n"), "utf8"));
    const key = `org/${orgId}/site/${siteId}/jobs/${job.id}.ndjson.gz`;
    const { error } = await db().storage.from(LOG_BUCKET).upload(key, body, { contentType: "application/gzip", upsert: true });
    if (error) throw new Error(`Archiving ${job.id}: ${error.message}`);
    // Recorded first, then the hot copy removed: an interrupted run leaves both, never neither.
    await db().from("acc_log_archives").insert({ org_id: orgId, site_id: siteId, job_id: job.id, storage_key: key, events: events.length, bytes: body.byteLength });
    await db().from("acc_job_events").delete().eq("job_id", job.id);
    count += 1;
  }
  return count;
}

async function deleteExpiredArchives(orgId: string, settings: RetentionSettings, now: number): Promise<number> {
  const archives = await rows(db().from("acc_log_archives").select("id, site_id, storage_key, archived_at, deleted_at").eq("org_id", orgId).is("deleted_at", null).limit(500));
  const due = archivesToDelete(archives.map((a) => ({ id: a.id as string, archivedAt: a.archived_at as string, deleted: !!a.deleted_at })), settings, now);
  for (const a of due) {
    const row = archives.find((x) => x.id === a.id)!;
    if (row.storage_key) {
      const { error } = await db().storage.from(LOG_BUCKET).remove([row.storage_key as string]);
      if (error) throw new Error(`Deleting archive ${a.id}: ${error.message}`);
    }
    await db().from("acc_log_archives").update({ deleted_at: new Date(now).toISOString() }).eq("id", a.id);
  }
  return due.length;
}

async function pruneDrafts(orgId: string, settings: RetentionSettings): Promise<number> {
  const versions = await rows(db().from("acc_document_versions").select("id, document_id, version, approved_at, pruned_at").eq("org_id", orgId).limit(5000));
  if (!versions.length) return 0;
  const docs = await rows(db().from("acc_documents").select("id, org_id, site_id, work_id, kind, title").eq("org_id", orgId));
  // A version a decision names ("brief v3", "design v2") stays, whatever the setting.
  const decisions = await rows(db().from("acc_decisions").select("work_id, target").eq("org_id", orgId).not("target", "is", null));
  const named = new Set(decisions.flatMap((d) => {
    const m = /\bv(\d+)\b/.exec(String(d.target));
    return m ? [`${d.work_id}:${m[1]}`] : [];
  }));
  const workOf = new Map(docs.map((d) => [d.id as string, d]));
  const referenced = new Set(versions.filter((v) => named.has(`${workOf.get(v.document_id as string)?.work_id}:${v.version}`)).map((v) => v.id as string));
  const prune = draftsToPrune(
    versions.map((v) => ({ id: v.id as string, documentId: v.document_id as string, version: v.version as number, approved: !!v.approved_at, pruned: !!v.pruned_at })),
    referenced,
    settings.draftsKept,
  );
  if (!prune.length) return 0;
  const at = new Date().toISOString();
  for (const v of prune) await db().from("acc_document_versions").update({ body: null, pruned_at: at }).eq("id", v.id).is("pruned_at", null);
  // One ledger line per document: history stays honest about what is gone.
  const perDoc = new Map<string, number[]>();
  for (const v of prune) perDoc.set(v.documentId, [...(perDoc.get(v.documentId) ?? []), v.version]);
  for (const [docId, list] of perDoc) {
    const doc = workOf.get(docId);
    if (!doc) continue;
    const vs = list.sort((a, b) => a - b);
    await record(
      { org_id: doc.org_id, site_id: doc.site_id, id: doc.work_id },
      { kind: "pruned", actor: { kind: "system", label: "Retention" }, summary: `Drafts v${vs.join(", v")} of the ${doc.kind} "${doc.title}" pruned under drafts kept = ${settings.draftsKept}.`, refs: { document: docId, versions: vs } },
    );
  }
  return prune.length;
}
