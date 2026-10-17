import { db, rows, type Row } from "./supabase";

/**
 * The traceability store, step T1 (gen2-crew.md §21.6, D48): decisions,
 * evidence and the Change Ledger, written alongside today's columns. Until the
 * backfill (T2) makes them authoritative, a failed write here is logged and
 * never breaks the work it records: the rail's columns still decide.
 */

/** The work row (or any row carrying org_id, site_id and the work id). */
type Scope = Row;
export type Actor =
  | { kind: "person"; userId: string; label: string; role?: string | null; via?: "button" | "typed" }
  | { kind: "policy"; label: string }
  | { kind: "crew"; label: string }
  | { kind: "system"; label: string };

/** The crew role behind a job's model setting, as the ledger and contribution graph name it. */
export const CREW_ROLE: Record<string, string> = { consult: "Team Lead", design: "Designer", plan: "Planner", build: "Builder", judge: "Judge" };

async function write(table: string, value: Row): Promise<Row | null> {
  try {
    const { data, error } = await db().from(table).insert(value).select("*").single();
    if (error) throw new Error(error.message);
    return (data as Row) ?? null;
  } catch (err) {
    console.error(`[ledger] ${table}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** One entry on the site's timeline. `counts` marks an evidence-backed contribution (§21.5). */
export async function record(w: Scope, e: { kind: string; actor: Actor; summary: string; counts?: boolean; refs?: Row }) {
  await write("acc_ledger", {
    org_id: w.org_id, site_id: w.site_id, work_id: w.id ?? null, kind: e.kind,
    actor_kind: e.actor.kind, actor_label: e.actor.label, summary: e.summary.slice(0, 500), counts: !!e.counts, refs: e.refs ?? {},
  });
}

/** A decision, by a person or a policy, bound to its exact target; also a ledger entry. */
export async function decide(w: Scope, d: { kind: string; actor: Extract<Actor, { kind: "person" | "policy" }>; target?: string | null; summary: string; detail?: Row }) {
  const person = d.actor.kind === "person" ? d.actor : null;
  const row = await write("acc_decisions", {
    org_id: w.org_id, site_id: w.site_id, work_id: w.id ?? null, kind: d.kind,
    actor_kind: d.actor.kind, actor_user_id: person?.userId ?? null, actor_label: d.actor.label, actor_role: person?.role ?? null,
    via: person ? (person.via ?? "button") : "policy", target: d.target ?? null, detail: d.detail ?? {},
  });
  await record(w, { kind: "decision", actor: d.actor, summary: d.summary, counts: true, refs: { decision: row?.id ?? null, decisionKind: d.kind, target: d.target ?? null } });
}

/** Void earlier decisions that new facts made stale (new code, a revised Brief, an escalation). History is kept. */
export async function invalidate(w: Scope, kinds: string[], reason: string) {
  try {
    const voided = await rows(
      db().from("acc_decisions").update({ invalidated_at: new Date().toISOString(), invalidated_reason: reason }).eq("work_id", w.id as string).in("kind", kinds).is("invalidated_at", null).select("id, kind"),
    );
    if (voided.length) await record(w, { kind: "invalidated", actor: { kind: "system", label: "Accelerator" }, summary: `${voided.map((v) => String(v.kind).replace("_", " ")).join(", ")} voided: ${reason}`, refs: { decisions: voided.map((v) => v.id) } });
  } catch (err) {
    console.error("[ledger] invalidate:", err instanceof Error ? err.message : err);
  }
}

/** One check run, bound to the exact candidate; also a ledger entry (a contribution when it passed). */
export async function evidence(
  w: Scope,
  e: { kind: "step_checks" | "prove" | "release"; ok: boolean; commit?: string | null; tests?: { passed: number; failed: number; total: number } | null; jobId?: string; stepId?: string; detail?: Row; actor: Actor; summary: string },
) {
  const row = await write("acc_evidence", {
    org_id: w.org_id, site_id: w.site_id, work_id: w.id ?? null, job_id: e.jobId ?? null, step_id: e.stepId ?? null, kind: e.kind,
    commit_sha: e.commit ?? null, ok: e.ok, passed: e.tests?.passed ?? null, failed: e.tests?.failed ?? null, total: e.tests?.total ?? null, detail: e.detail ?? {},
  });
  await record(w, { kind: e.kind, actor: e.actor, summary: e.summary, counts: e.ok, refs: { evidence: row?.id ?? null, commit: e.commit ?? null, job: e.jobId ?? null, step: e.stepId ?? null } });
}
