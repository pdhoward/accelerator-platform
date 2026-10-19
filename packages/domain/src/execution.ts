import type { JobKind } from "./flywheel";

/**
 * Reliable execution (gen2-crew.md §14) and retention (§21.4): pure policy the
 * API applies. A runner claims a job for a while and renews the claim as it
 * works; each claim has a generation, so a worker whose claim lapsed can never
 * commit a result (§14.1). What happens to a lapsed job depends on whether it
 * may already have changed the outside world (§14.2): a release may have, so
 * its outcome is recorded as unknown and never retried blindly.
 */

/** How long a claim lasts without renewal; the runner renews every minute. */
export const CLAIM_MS = 10 * 60_000;
/** Times a job may be claimed before it's given up as failed. */
export const MAX_JOB_ATTEMPTS = 2;

/** Jobs whose run may change something outside the platform (a pushed branch is harmless; main and production are not). */
const SIDE_EFFECTS: ReadonlySet<JobKind> = new Set(["release"]);

export type LapsedFate =
  | { fate: "requeue"; note: string }
  | { fate: "fail"; note: string }
  | { fate: "unknown"; note: string };

/** What to do with a running job whose claim lapsed (the runner stopped, crashed or lost its network). */
export function lapsedFate(job: { kind: JobKind; attempts: number }): LapsedFate {
  if (SIDE_EFFECTS.has(job.kind)) {
    return {
      fate: "unknown",
      note: "The runner stopped in the middle of a release, so whether main and production changed is unknown. Check main and the live site before releasing again.",
    };
  }
  if (job.attempts < MAX_JOB_ATTEMPTS) return { fate: "requeue", note: "The runner stopped mid-run; the job goes back in the queue for another try." };
  return { fate: "fail", note: `The runner stopped on this job ${job.attempts} times, so it's given up. Ask the lead, or run it again.` };
}

/** Whether a claim has lapsed; claims from before expiry was recorded lapse 30 minutes after they started. */
export function claimLapsed(job: { claimExpiresAt: string | null; startedAt: string | null }, now: number): boolean {
  if (job.claimExpiresAt) return Date.parse(job.claimExpiresAt) < now;
  return !!job.startedAt && Date.parse(job.startedAt) + 30 * 60_000 < now;
}

// ── Retention (§21.4) ────────────────────────────────────────────────────────
export type RetentionSettings = { draftsKept: number; logsHotDays: number; logsRetentionDays: number; artifactsRetentionDays: number };
export const DEFAULT_RETENTION: RetentionSettings = { draftsKept: 10, logsHotDays: 30, logsRetentionDays: 365, artifactsRetentionDays: 365 };

export type DraftVersion = { id: string; documentId: string; version: number; approved: boolean; pruned: boolean };

/**
 * The draft versions to prune. Kept for the life of the subscription, whatever
 * the setting: anything approved, the current (newest) version of each
 * document, and anything a decision references. Of the rest, the newest
 * `draftsKept` per document stay.
 */
export function draftsToPrune(versions: DraftVersion[], referenced: ReadonlySet<string>, draftsKept: number): DraftVersion[] {
  const byDoc = new Map<string, DraftVersion[]>();
  for (const v of versions) byDoc.set(v.documentId, [...(byDoc.get(v.documentId) ?? []), v]);
  const out: DraftVersion[] = [];
  for (const list of byDoc.values()) {
    const sorted = [...list].sort((a, b) => b.version - a.version);
    const current = sorted[0]?.id;
    const drafts = sorted.filter((v) => v.id !== current && !v.approved && !referenced.has(v.id));
    out.push(...drafts.slice(Math.max(0, draftsKept)).filter((v) => !v.pruned));
  }
  return out;
}

/** Jobs whose logs move from the database to storage: finished more than `logsHotDays` ago and not yet archived. */
export function logsToArchive(jobs: { id: string; finishedAt: string | null; archived: boolean }[], settings: RetentionSettings, now: number) {
  const before = now - settings.logsHotDays * 86_400_000;
  return jobs.filter((j) => !j.archived && !!j.finishedAt && Date.parse(j.finishedAt) < before);
}

/** Archives past their retention: deleted from storage, with the deletion recorded. */
export function archivesToDelete(archives: { id: string; archivedAt: string; deleted: boolean }[], settings: RetentionSettings, now: number) {
  const before = now - settings.logsRetentionDays * 86_400_000;
  return archives.filter((a) => !a.deleted && Date.parse(a.archivedAt) < before);
}
