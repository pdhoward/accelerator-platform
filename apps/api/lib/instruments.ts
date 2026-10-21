import {
  buildInstruments,
  type InstrumentEvidence,
  type InstrumentInputs,
  type InstrumentLedger,
  type InstrumentWork,
  type InstrumentsResponse,
  type Site,
  type WorkItem,
} from "@accelerator/domain";

import { demoMode } from "./auth";
import { CodeError } from "./codes";
import { instrumentsSample, sampleItems } from "./studio-sample";
import { db, rows } from "./supabase";
import { listWork, pendingDecisions } from "./work";

/**
 * The Cockpit Dial's readings for a site or one Work item (gen2-crew.md §19.5).
 * The API only gathers records; packages/domain decides every number and
 * condition. Keyless demo mode gets clearly labelled synthetic records.
 */

const DAY = 86_400_000;

export async function readInstruments(site: Site, number?: number): Promise<InstrumentsResponse> {
  const now = new Date().toISOString();
  const scope: InstrumentInputs["scope"] = number != null ? { kind: "work", number } : { kind: "site" };
  if (number != null && (!Number.isSafeInteger(number) || number < 1)) throw new CodeError("Invalid work number.");

  if (demoMode()) {
    if (!site.demo) throw new CodeError("Live instruments require the database.");
    if (number != null && !sampleItems().some((d) => d.work.number === number)) throw new CodeError("That sample work item does not exist.");
    return { ...buildInstruments({ ...instrumentsSample(now), scope }), source: "sample", siteName: site.name };
  }

  const items = await listWork(site.id);
  if (number != null && !items.some((w) => w.number === number)) throw new CodeError("That work item doesn't exist.");
  const numberOf = new Map(items.map((w) => [w.id, w.number]));
  const evidenceSince = new Date(Date.now() - 90 * DAY).toISOString();
  const ledgerSince = new Date(Date.now() - 35 * DAY).toISOString();

  const [evidence, ledger, [s], pending] = await Promise.all([
    rows(
      db()
        .from("acc_evidence")
        .select("kind, ok, commit_sha, passed, failed, total, created_at, work_id, step_id, detail")
        .eq("site_id", site.id)
        .gte("created_at", evidenceSince)
        .order("created_at")
        .limit(3000),
    ),
    rows(
      db()
        .from("acc_ledger")
        .select("at, kind, actor_kind, actor_label, counts, work_id, summary")
        .eq("site_id", site.id)
        .gte("at", ledgerSince)
        .order("at")
        .limit(5000),
    ),
    rows(db().from("acc_sites").select("baseline_tests").eq("id", site.id)),
    pendingDecisions(items),
  ]);

  const workNumber = (id: unknown) => (typeof id === "string" ? (numberOf.get(id) ?? null) : null);
  const waiting = new Map(pending.map((p) => [p.number, p]));
  return {
    ...buildInstruments({
      now,
      scope,
      baselineTests: (s?.baseline_tests as number) ?? null,
      work: items.map((w): InstrumentWork => toInstrumentWork(w, waiting.get(w.number) ?? null)),
      evidence: evidence.map(
        (e): InstrumentEvidence => ({
          kind: e.kind as string, ok: !!e.ok, commit: (e.commit_sha as string) ?? null,
          passed: (e.passed as number) ?? null, failed: (e.failed as number) ?? null, total: (e.total as number) ?? null,
          at: e.created_at as string, work: workNumber(e.work_id), step: (e.step_id as string) ?? null, detail: (e.detail as Record<string, unknown>) ?? {},
        }),
      ),
      ledger: ledger.map(
        (l): InstrumentLedger => ({
          at: l.at as string, kind: l.kind as string, actorKind: l.actor_kind as InstrumentLedger["actorKind"], actorLabel: l.actor_label as string,
          counts: !!l.counts, work: workNumber(l.work_id), summary: l.summary as string,
        }),
      ),
    }),
    source: "recorded",
    siteName: site.name,
  };
}

const toInstrumentWork = (w: WorkItem, pending: { title: string; since: string } | null): InstrumentWork => ({
  number: w.number, title: w.title, kind: w.kind, stage: w.stage, complexity: w.complexity, createdAt: w.createdAt,
  released: w.released, releasedAt: w.released ? (w.release?.at ?? w.updatedAt) : null, paused: w.paused,
  pending: pending ? { title: pending.title, since: pending.since } : null,
});
