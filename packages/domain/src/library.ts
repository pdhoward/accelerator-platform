import { COMPLEXITY_LABEL, type Complexity } from "./complexity";
import type { Mandate } from "./mandate";

/**
 * The Library (gen2-crew.md §3, G2.5): the Site Timeline over the ledger, the
 * Work item record the Librarian writes into the client's repository at Prove
 * (traceability T5), and the export bundle. Pure.
 */

// ── The Site Timeline ────────────────────────────────────────────────────────
export type TimelineEntry = {
  id: number;
  at: string;
  kind: string;
  actorKind: "person" | "crew" | "policy" | "system";
  actor: string;
  summary: string;
  counts: boolean;
  work: { number: number; title: string } | null;
  refs: Record<string, unknown>;
};

export const TIMELINE_FILTERS = ["all", "decisions", "evidence", "crew", "people", "system"] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

const DECISION_KINDS = new Set(["decision", "approved", "shipped", "released", "closed", "cancelled", "paused", "resumed", "mandate", "invalidated"]);
const EVIDENCE_KINDS = new Set(["evidence", "step_checks", "prove", "release", "census"]);

export function timelineCategory(e: Pick<TimelineEntry, "kind" | "actorKind">): Exclude<TimelineFilter, "all"> {
  if (DECISION_KINDS.has(e.kind) || e.actorKind === "policy") return "decisions";
  if (EVIDENCE_KINDS.has(e.kind)) return "evidence";
  if (e.actorKind === "person") return "people";
  if (e.actorKind === "crew") return "crew";
  return "system";
}

export const readTimelineFilter = (v: unknown): TimelineFilter => ((TIMELINE_FILTERS as readonly string[]).includes(String(v)) ? (v as TimelineFilter) : "all");

/** Entries grouped by day, newest first, for one filter. */
export function timelineDays(entries: TimelineEntry[], filter: TimelineFilter = "all"): { day: string; entries: TimelineEntry[] }[] {
  const keep = filter === "all" ? entries : entries.filter((e) => timelineCategory(e) === filter);
  const days = new Map<string, TimelineEntry[]>();
  for (const e of [...keep].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)) {
    const day = e.at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return [...days.entries()].map(([day, list]) => ({ day, entries: list }));
}

export type TimelineResponse = { entries: TimelineEntry[]; next: number | null; filter: TimelineFilter; sample?: boolean };

// ── The Work item record (T5) ────────────────────────────────────────────────
export type RecordInput = {
  site: string;
  work: { number: number; title: string; complexity: Complexity; stage: string; branch: string | null };
  mandate: Mandate | null;
  document: { kind: "brief" | "design"; version: number; body: string; approvedAt: string | null } | null;
  steps: { position: number; title: string; status: string }[];
  decisions: { at: string; kind: string; by: string; via: string | null; target: string | null; voided: string | null }[];
  evidence: { at: string; kind: string; ok: boolean; commit: string | null; tests: string | null }[];
};

/** The path the Librarian writes in the client's repository. Only under docs/accelerator/. */
export const recordPath = (number: number) => `docs/accelerator/work-${number}.md`;

/**
 * One Work item's record as Markdown: deterministic, so writing it twice
 * changes nothing, and readable without the platform.
 */
export function workRecordMarkdown(r: RecordInput): string {
  const lines: string[] = [
    `# Work #${r.work.number}: ${r.work.title}`,
    "",
    `Site: ${r.site} · Complexity: ${COMPLEXITY_LABEL[r.work.complexity]} · Stage: ${r.work.stage}${r.work.branch ? ` · Branch: \`${r.work.branch}\`` : ""}`,
    "",
    "> Written by the Accelerator's Librarian at Prove. It records what was agreed, decided and proven. Edit the item in the Control Room, not here.",
  ];
  if (r.mandate) {
    const m = r.mandate;
    lines.push("", `## Mandate (v${m.version})`, "", `**Outcome:** ${m.outcome}`);
    const sec = (t: string, xs: string[]) => xs.length && lines.push("", `**${t}:**`, ...xs.map((x) => `- ${x}`));
    sec("In scope", m.scope);
    sec("Out of scope", m.outOfScope);
    sec("Acceptance criteria", m.acceptance);
    sec("Protected behavior", m.protected);
    if (m.budgetUsd != null) lines.push("", `**Budget:** $${m.budgetUsd.toFixed(2)}`);
  }
  if (r.document) {
    const title = r.document.kind === "brief" ? "Brief" : "Design";
    lines.push("", `## ${title} (v${r.document.version}${r.document.approvedAt ? `, approved ${r.document.approvedAt.slice(0, 10)}` : ", not approved"})`, "", r.document.body.replace(/^#\s+/m, "### ").replace(/^##\s/gm, "#### ").trim());
  }
  if (r.steps.length) lines.push("", "## Plan", "", ...r.steps.map((s) => `${s.position}. ${s.title} (${s.status})`));
  const valid = r.decisions.filter((d) => !d.voided);
  if (r.decisions.length) {
    lines.push("", "## Decisions", "", "| When | Decision | By | How | On |", "|---|---|---|---|---|");
    for (const d of r.decisions) lines.push(`| ${d.at.slice(0, 16).replace("T", " ")} | ${d.kind}${d.voided ? ` (voided: ${d.voided})` : ""} | ${d.by} | ${d.via ?? ""} | ${d.target ?? ""} |`);
    if (valid.length !== r.decisions.length) lines.push("", `${r.decisions.length - valid.length} decision(s) were voided by later changes and are kept for the record.`);
  }
  if (r.evidence.length) {
    lines.push("", "## Evidence", "", "| When | Check | Result | Tests | Commit |", "|---|---|---|---|---|");
    for (const e of r.evidence) lines.push(`| ${e.at.slice(0, 16).replace("T", " ")} | ${e.kind} | ${e.ok ? "pass" : "fail"} | ${e.tests ?? ""} | ${e.commit ? `\`${e.commit.slice(0, 8)}\`` : ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

// ── Export ───────────────────────────────────────────────────────────────────
export const EXPORT_VERSION = 1;

export type ExportManifest = {
  format: "accelerator-export";
  version: number;
  site: { slug: string; name: string; url: string };
  exportedAt: string;
  exportedBy: string;
  counts: Record<string, number>;
  notes: string[];
};

export function exportManifest(input: { site: ExportManifest["site"]; at: string; by: string; tables: Record<string, unknown[]> }): ExportManifest {
  return {
    format: "accelerator-export",
    version: EXPORT_VERSION,
    site: input.site,
    exportedAt: input.at,
    exportedBy: input.by,
    counts: Object.fromEntries(Object.entries(input.tables).map(([k, v]) => [k, v.length])),
    notes: [
      "Keys and secrets are never exported; the vault lists names only.",
      "Pruned draft versions keep their hash and size; their text is gone by the retention setting.",
      "Archived job logs are in storage; their keys are listed under log_archives.",
    ],
  };
}
