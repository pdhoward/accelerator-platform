/**
 * Gen 3, the Cradle (accelerator/work/gen3-cradle.md): the policy graph that a
 * site's app lives in. An industry pack (cradle-packs.ts) supplies the
 * starter book: concepts with their lifecycle events, policies in controlled
 * English, kernels and components. The site's own layer binds to it: adopting,
 * overriding with a reason, or adding policies found in its code (ingest) or
 * stated by its steward. Everything here is pure; storage is the API's job.
 */

import type { Domain } from "./domains";
import type { Reading } from "./instruments";

// ── The graph's vocabulary ───────────────────────────────────────────────────

/** What happens if we get the policy wrong (§1.3). Not the same as complexity. */
export type Criticality = "critical" | "important" | "routine";
export const CRITICALITY_RANK: Record<Criticality, number> = { routine: 0, important: 1, critical: 2 };
export const CRITICALITY_LABEL: Record<Criticality, string> = { critical: "Critical", important: "Important", routine: "Routine" };

/** Parametric policies change as data; structural ones live in a kernel's code (§2.7). */
export type PolicyForm = "parametric" | "structural";
/** How sure the crew is that the code says this (§13.3): never the same as approval. */
export type ExtractionStatus = "candidate" | "source_verified" | "unsupported";
/** What the steward has ruled. */
export type BusinessStatus = "unreviewed" | "confirmed" | "disputed" | "retired";
/** Where a site's policy stands against the pack. */
export type Binding = "adopted" | "overridden" | "site";

export type ParamValue = string | number | boolean;
export type Example = { given: string; when: string; then: string };
export type PolicySource = { path: string; lines?: string; quote?: string };

export type Concept = {
  key: string;
  label: string;
  /** The lifecycle events a complete book must govern; a missing one is a hole. */
  events: string[];
  /** No policy on this concept may be rated below this. */
  floor: Criticality;
};

export type Kernel = {
  key: string;
  label: string;
  kind: "kernel" | "connector";
  /** Available in the pack, or still to be built for this industry. */
  status: "available" | "planned";
};

export type Component = { key: string; label: string; expresses: string[] };

export type Policy = {
  key: string;
  concept: string;
  event: string;
  title: string;
  /** Controlled English (about 80% of ASD-STE100, §3.3): one idea per sentence. */
  statement: string;
  criticality: Criticality;
  form: PolicyForm;
  parameters: Record<string, ParamValue>;
  kernel: string | null;
  examples: Example[];
  /** The owner role, which is also the referee for its contradictions. */
  owner: string;
  /** Review-by date (ISO); every policy has one (G3-D5). */
  reviewBy: string | null;
  regulation?: string | null;
};

export type Pack = {
  id: Domain;
  version: string;
  label: string;
  summary: string;
  concepts: Concept[];
  kernels: Kernel[];
  components: Component[];
  policies: Policy[];
};

/** A policy as the site holds it: the pack's, overlaid with the site's layer. */
export type BookPolicy = Policy & {
  binding: Binding;
  /** The pack's parameters when the site overrides them. */
  packParameters: Record<string, ParamValue> | null;
  reason: string | null;
  extraction: ExtractionStatus | null;
  status: BusinessStatus;
  sources: PolicySource[];
  /** Where the policy is stated to people (pages, emails, the assistant). */
  surfaces: string[];
  version: number;
  ruledBy: string | null;
  ruledAt: string | null;
};

/** The site's layer, as stored: only what differs from, or adds to, the pack. */
export type SitePolicy = Partial<Omit<Policy, "key">> & {
  key: string;
  binding: Binding;
  reason?: string | null;
  extraction?: ExtractionStatus | null;
  status: BusinessStatus;
  sources?: PolicySource[];
  surfaces?: string[];
  version: number;
  ruledBy?: string | null;
  ruledAt?: string | null;
};

/** A contradiction the crew found (§2.4), waiting for its referee or ruled on. */
export type Conflict = {
  id: string;
  kind: "policy" | "regulation" | "surface";
  keys: string[];
  why: string;
  status: "open" | "resolved";
  ruling?: string | null;
};

// ── Assembling the book ──────────────────────────────────────────────────────

const ALL_EVENTS = (pack: Pack) => new Map(pack.concepts.map((c) => [c.key, c]));

/** The floor of the concept, raised by the policy's own rating; never lowered. */
export function criticalityOf(pack: Pack, concept: string, rated: Criticality | undefined): Criticality {
  const floor = ALL_EVENTS(pack).get(concept)?.floor ?? "routine";
  const r = rated ?? floor;
  return CRITICALITY_RANK[r] >= CRITICALITY_RANK[floor] ? r : floor;
}

/** The book in force: every pack policy (adopted unless the site says otherwise), then the site's own. */
export function assembleBook(pack: Pack, site: SitePolicy[]): BookPolicy[] {
  const byKey = new Map(site.map((s) => [s.key, s]));
  const fromPack = pack.policies.map((p): BookPolicy => {
    const s = byKey.get(p.key);
    const parameters = { ...p.parameters, ...(s?.parameters ?? {}) };
    const overridden = s?.binding === "overridden" || (s ? !sameParams(parameters, p.parameters) : false);
    return {
      ...p,
      ...(s ? strip(s) : {}),
      key: p.key,
      concept: p.concept,
      event: p.event,
      parameters,
      criticality: criticalityOf(pack, p.concept, s?.criticality ?? p.criticality),
      binding: overridden ? "overridden" : "adopted",
      packParameters: overridden ? p.parameters : null,
      reason: s?.reason ?? null,
      extraction: s?.extraction ?? null,
      status: s?.status ?? "unreviewed",
      sources: s?.sources ?? [],
      surfaces: s?.surfaces ?? [],
      version: s?.version ?? 0,
      ruledBy: s?.ruledBy ?? null,
      ruledAt: s?.ruledAt ?? null,
    };
  });
  const packKeys = new Set(pack.policies.map((p) => p.key));
  const own = site
    .filter((s) => !packKeys.has(s.key))
    .map((s): BookPolicy => ({
      key: s.key,
      concept: s.concept ?? "other",
      event: s.event ?? "other",
      title: s.title ?? s.key,
      statement: s.statement ?? "",
      criticality: criticalityOf(pack, s.concept ?? "other", s.criticality),
      form: s.form ?? "parametric",
      parameters: s.parameters ?? {},
      kernel: s.kernel ?? null,
      examples: s.examples ?? [],
      owner: s.owner ?? "Steward",
      reviewBy: s.reviewBy ?? null,
      regulation: s.regulation ?? null,
      binding: "site",
      packParameters: null,
      reason: s.reason ?? null,
      extraction: s.extraction ?? null,
      status: s.status,
      sources: s.sources ?? [],
      surfaces: s.surfaces ?? [],
      version: s.version,
      ruledBy: s.ruledBy ?? null,
      ruledAt: s.ruledAt ?? null,
    }));
  return [...fromPack, ...own].filter((p) => p.status !== "retired");
}

function strip(s: SitePolicy): Partial<Policy> {
  const out: Partial<Policy> = {};
  for (const k of ["title", "statement", "form", "kernel", "examples", "owner", "reviewBy", "regulation"] as const) {
    if (s[k] !== undefined) (out as Record<string, unknown>)[k] = s[k];
  }
  return out;
}

export function sameParams(a: Record<string, ParamValue>, b: Record<string, ParamValue>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// ── Checks (§4, the graph checks and the Policy Walk's completion) ───────────

export type FindingKind = "conflict" | "hole" | "needs_kernel" | "unproven" | "unreviewed" | "no_review_date";
export type Finding = {
  kind: FindingKind;
  criticality: Criticality;
  title: string;
  detail: string;
  keys: string[];
  /** For holes: the concept and event with no policy. */
  at?: { concept: string; event: string };
  conflictId?: string;
};

export const FINDING_LABEL: Record<FindingKind, string> = {
  conflict: "Contradiction",
  hole: "Hole",
  needs_kernel: "Needs a kernel",
  unproven: "No example",
  unreviewed: "Waiting for the steward",
  no_review_date: "No review date",
};

export function findings(pack: Pack, book: BookPolicy[], conflicts: Conflict[]): Finding[] {
  const out: Finding[] = [];
  const kernels = new Map(pack.kernels.map((k) => [k.key, k]));
  const byKey = new Map(book.map((p) => [p.key, p]));

  for (const c of conflicts.filter((c) => c.status === "open")) {
    const crit = c.keys.map((k) => byKey.get(k)?.criticality ?? "important").reduce(maxCrit, "routine" as Criticality);
    out.push({ kind: "conflict", criticality: crit, title: c.keys.map((k) => byKey.get(k)?.title ?? k).join(" vs "), detail: c.why, keys: c.keys, conflictId: c.id });
  }
  for (const concept of pack.concepts) {
    for (const event of concept.events) {
      if (!book.some((p) => p.concept === concept.key && p.event === event)) {
        out.push({ kind: "hole", criticality: concept.floor, title: `${concept.label}: ${event.replace(/_/g, " ")}`, detail: `No policy governs "${event.replace(/_/g, " ")}" for ${concept.label.toLowerCase()}.`, keys: [], at: { concept: concept.key, event } });
      }
    }
  }
  for (const p of book) {
    if (p.criticality === "critical" && (!p.kernel || kernels.get(p.kernel)?.status !== "available")) {
      out.push({ kind: "needs_kernel", criticality: p.criticality, title: p.title, detail: p.kernel ? `${kernels.get(p.kernel)?.label ?? p.kernel} is planned but not built yet. A critical policy runs only through a kernel or guard.` : "A critical policy runs only through a kernel or guard, and none is named.", keys: [p.key] });
    }
    if (!p.examples.length) out.push({ kind: "unproven", criticality: p.criticality, title: p.title, detail: "No Given/When/Then example proves it yet.", keys: [p.key] });
    if (p.status === "unreviewed" || p.status === "disputed") out.push({ kind: "unreviewed", criticality: p.criticality, title: p.title, detail: p.status === "disputed" ? "Disputed: the steward must rule." : p.binding === "adopted" ? "A pack default the steward hasn't confirmed." : "Found in the code; the steward hasn't confirmed it.", keys: [p.key] });
    if (!p.reviewBy) out.push({ kind: "no_review_date", criticality: "routine", title: p.title, detail: "Every policy needs a review-by date.", keys: [p.key] });
  }
  const order: FindingKind[] = ["conflict", "hole", "needs_kernel", "unreviewed", "unproven", "no_review_date"];
  return out.sort((a, b) => CRITICALITY_RANK[b.criticality] - CRITICALITY_RANK[a.criticality] || order.indexOf(a.kind) - order.indexOf(b.kind));
}

const maxCrit = (a: Criticality, b: Criticality): Criticality => (CRITICALITY_RANK[a] >= CRITICALITY_RANK[b] ? a : b);

/** The readiness the Overview and the Policy screen show (the book's vital signs). */
export type BookReadiness = {
  policies: number;
  confirmed: number;
  critical: number;
  criticalConfirmed: number;
  conflicts: number;
  holes: number;
  criticalHoles: number;
  needsKernel: number;
  unproven: number;
  /** Share of policies that change as data, without code (§2.7). */
  parametricShare: number;
  /** Share of policies found in, or matched to, the site's code. */
  grounded: number;
  /** The Policy Walk is done when this is true (§3.2). */
  complete: boolean;
};

export function readiness(book: BookPolicy[], found: Finding[]): BookReadiness {
  const critical = book.filter((p) => p.criticality === "critical");
  const count = (k: FindingKind, crit?: Criticality) => found.filter((f) => f.kind === k && (!crit || f.criticality === crit)).length;
  const r: BookReadiness = {
    policies: book.length,
    confirmed: book.filter((p) => p.status === "confirmed").length,
    critical: critical.length,
    criticalConfirmed: critical.filter((p) => p.status === "confirmed").length,
    conflicts: count("conflict"),
    holes: count("hole"),
    criticalHoles: count("hole", "critical"),
    needsKernel: count("needs_kernel"),
    unproven: count("unproven"),
    parametricShare: book.length ? Math.round((book.filter((p) => p.form === "parametric").length / book.length) * 100) : 0,
    grounded: book.filter((p) => p.sources.length > 0).length,
    complete: false,
  };
  r.complete = r.critical > 0 && r.criticalConfirmed === r.critical && r.conflicts === 0 && r.criticalHoles === 0 && found.every((f) => f.kind !== "unproven" || f.criticality !== "critical");
  return r;
}

// ── Ingest: the crew reads the site and reports what its code implies ───────

export type IngestCandidate = {
  /** The pack policy this matches, if any. */
  packKey?: string | null;
  concept: string;
  event: string;
  title: string;
  statement: string;
  parameters: Record<string, ParamValue>;
  form: PolicyForm;
  criticality?: Criticality;
  sources: PolicySource[];
  surfaces?: string[];
};

export type IngestReport = {
  summary: string;
  candidates: IngestCandidate[];
  conflicts: { keys: string[]; why: string; kind?: Conflict["kind"] }[];
  filesRead?: number;
};

/** What the extractor is told: the pack's concepts and policies, and the exact shape to report. */
export function ingestInstruction(pack: Pack): string {
  return `You are the crew's Policy Extractor. Read this repository (read-only) and report the business policies its code, content and pages already imply.

The site is in the ${pack.label} industry. The industry pack's concepts and lifecycle events:
${pack.concepts.map((c) => `- ${c.key} (${c.label}): ${c.events.join(", ")}`).join("\n")}

The pack's starter policies (match to these by key when the code implements the same rule, even with different values):
${pack.policies.map((p) => `- ${p.key} [${p.concept}/${p.event}] ${p.statement} ${JSON.stringify(p.parameters)}`).join("\n")}

Rules:
- Report only what the code, content or configuration shows. Cite every claim: file path, line numbers and a short quote.
- Write each statement in controlled English: short sentences, one idea each, active voice, no ambiguous words.
- Mark a policy "parametric" when its values are data (config, constants, a table), "structural" when the rule is the code's logic itself.
- When a page, email or the assistant states a policy, list that file under surfaces.
- When two sources disagree (for example the code charges one amount and a page states another), report a conflict with both keys and why.
- Use the pack's concept and event names. For something the pack lacks, use concept "other" and a short event name.

Finish with exactly one fenced \`\`\`json block shaped like:
{"summary": "...", "candidates": [{"packKey": "C-SHIP-1" | null, "concept": "...", "event": "...", "title": "...", "statement": "...", "parameters": {}, "form": "parametric" | "structural", "criticality": "critical" | "important" | "routine", "sources": [{"path": "...", "lines": "10-14", "quote": "..."}], "surfaces": ["..."]}], "conflicts": [{"keys": ["...", "..."], "why": "...", "kind": "policy" | "regulation" | "surface"}]}
For a candidate with no packKey, the key is assigned later; refer to it in conflicts by its title.`;
}

/** The extractor's report, from its final answer. Throws when there's no usable JSON. */
export function readIngest(text: string): IngestReport {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(fenced);
  } catch {
    throw new Error("The extractor's report wasn't valid JSON.");
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v.trim() : d);
  const candidates: IngestCandidate[] = (Array.isArray(o.candidates) ? o.candidates : []).flatMap((c: Record<string, unknown>) => {
    const statement = str(c?.statement);
    if (!statement) return [];
    const params = c.parameters && typeof c.parameters === "object" ? Object.fromEntries(Object.entries(c.parameters as Record<string, unknown>).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Record<string, ParamValue> : {};
    const crit = str(c.criticality);
    return [{
      packKey: str(c.packKey) || null,
      concept: str(c.concept, "other") || "other",
      event: str(c.event, "other") || "other",
      title: str(c.title) || statement.slice(0, 60),
      statement,
      parameters: params,
      form: c.form === "structural" ? "structural" : "parametric",
      criticality: crit === "critical" || crit === "important" || crit === "routine" ? crit : undefined,
      sources: (Array.isArray(c.sources) ? c.sources : []).filter((s: Record<string, unknown>) => str(s?.path)).map((s: Record<string, unknown>) => ({ path: str(s.path), lines: str(s.lines) || undefined, quote: str(s.quote) || undefined })),
      surfaces: (Array.isArray(c.surfaces) ? c.surfaces : []).map((s: unknown) => str(s)).filter(Boolean),
    } satisfies IngestCandidate];
  });
  const conflicts = (Array.isArray(o.conflicts) ? o.conflicts : []).flatMap((c: Record<string, unknown>) => {
    const keys = (Array.isArray(c?.keys) ? c.keys : []).map((k: unknown) => str(k)).filter(Boolean);
    const kind = c.kind === "regulation" || c.kind === "surface" ? c.kind : "policy";
    return keys.length && str(c.why) ? [{ keys, why: str(c.why), kind: kind as Conflict["kind"] }] : [];
  });
  return { summary: str(o.summary), candidates, conflicts };
}

/**
 * How an ingest report lands on the site's layer: a match with the pack's
 * values is adopted (and now grounded in code); a match with different values
 * is an override found in code; anything else is the site's own policy. Nothing
 * is confirmed: code confidence is not business approval.
 */
export function mergeIngest(pack: Pack, existing: SitePolicy[], report: IngestReport): { policies: SitePolicy[]; conflicts: Omit<Conflict, "id">[] } {
  const packByKey = new Map(pack.policies.map((p) => [p.key, p]));
  const have = new Map(existing.map((s) => [s.key, s]));
  const titleToKey = new Map<string, string>();
  const used = new Set(existing.map((s) => s.key));
  const policies: SitePolicy[] = [];

  for (const c of report.candidates) {
    const base = c.packKey ? packByKey.get(c.packKey) : undefined;
    const key = base ? base.key : nextKey(c.concept, used);
    used.add(key);
    titleToKey.set(c.title.toLowerCase(), key);
    const prior = have.get(key);
    const ruled = prior && prior.status !== "unreviewed";
    if (base) {
      const parameters = { ...base.parameters, ...c.parameters };
      const differs = !sameParams(parameters, base.parameters);
      policies.push({
        key, binding: differs ? "overridden" : "adopted", parameters: differs ? parameters : undefined,
        reason: differs ? "Found in the site's code" : prior?.reason ?? null,
        extraction: c.sources.length ? "source_verified" : "candidate",
        // A ruling stands unless the code now says something different from what was ruled.
        status: ruled && sameParams(parameters, { ...base.parameters, ...(prior?.parameters ?? {}) }) ? prior!.status : "unreviewed",
        sources: c.sources, surfaces: c.surfaces ?? [], version: (prior?.version ?? 0) + 1,
        ruledBy: ruled ? prior?.ruledBy ?? null : null, ruledAt: ruled ? prior?.ruledAt ?? null : null,
      });
    } else {
      policies.push({
        key, binding: "site", concept: c.concept, event: c.event, title: c.title, statement: c.statement, parameters: c.parameters, form: c.form,
        criticality: c.criticality, kernel: null, examples: [], owner: "Steward", reviewBy: null,
        extraction: c.sources.length ? "source_verified" : "candidate", status: "unreviewed", sources: c.sources, surfaces: c.surfaces ?? [], version: (prior?.version ?? 0) + 1,
      });
    }
  }
  const resolve = (k: string) => (packByKey.has(k) || used.has(k) ? k : titleToKey.get(k.toLowerCase()) ?? k);
  const conflicts = report.conflicts.map((c) => ({ kind: c.kind ?? "policy", keys: c.keys.map(resolve), why: c.why, status: "open" as const, ruling: null }));
  return { policies, conflicts };
}

function nextKey(concept: string, used: Set<string>): string {
  const stem = `S-${concept.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "OTHER"}`;
  let n = 1;
  while (used.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

// ── Rulings: the steward's decisions on the site's layer ─────────────────────

export type Ruling =
  | { action: "confirm" }
  | { action: "dispute"; reason: string }
  | { action: "retire"; reason: string }
  | { action: "set"; parameters: Record<string, ParamValue>; reason: string };

/** The site row after a ruling; the API stores it as the next version. */
export function applyRuling(pack: Pack, current: SitePolicy | undefined, key: string, ruling: Ruling, by: string, at: string): SitePolicy {
  const base = pack.policies.find((p) => p.key === key);
  if (!current && !base) throw new Error(`No policy ${key}.`);
  const row: SitePolicy = current ? { ...current } : { key, binding: "adopted", status: "unreviewed", version: 0 };
  row.version = (current?.version ?? 0) + 1;
  row.ruledBy = by;
  row.ruledAt = at;
  if (ruling.action === "confirm") row.status = "confirmed";
  else if (ruling.action === "dispute") Object.assign(row, { status: "disputed", reason: ruling.reason });
  else if (ruling.action === "retire") Object.assign(row, { status: "retired", reason: ruling.reason });
  else {
    const parameters = { ...(base?.parameters ?? {}), ...(row.parameters ?? {}), ...ruling.parameters };
    Object.assign(row, { parameters, reason: ruling.reason, status: "confirmed" });
    if (base) row.binding = sameParams(parameters, base.parameters) ? "adopted" : "overridden";
  }
  return row;
}

// ── The starter: what "create" sets up, like a framework's scaffold ──────────

export type StarterStep = { label: string; detail: string };

/** The scaffold a new cradle reports, in the order a terminal would print it. */
export function starterSteps(pack: Pack): StarterStep[] {
  const crit = pack.policies.filter((p) => p.criticality === "critical").length;
  return [
    { label: "Industry pack", detail: `${pack.label} ${pack.version}` },
    { label: "Ontology", detail: `${pack.concepts.length} concepts · ${pack.concepts.reduce((n, c) => n + c.events.length, 0)} lifecycle events` },
    { label: "Starter policies", detail: `${pack.policies.length} in controlled English · ${crit} critical` },
    { label: "Kernels and connectors", detail: `${pack.kernels.filter((k) => k.status === "available").length} available · ${pack.kernels.filter((k) => k.status === "planned").length} planned` },
    { label: "Components", detail: `${pack.components.length} registry components` },
    { label: "Examples", detail: `${pack.policies.reduce((n, p) => n + p.examples.length, 0)} Given/When/Then cases` },
  ];
}

export type CradleResponse = {
  cradle: { pack: Domain; packVersion: string; startedAt: string; startedBy: string | null; ingestedAt: string | null } | null;
  pack: Pack | null;
  book: BookPolicy[];
  conflicts: Conflict[];
  findings: Finding[];
  readiness: BookReadiness | null;
  ingest: { status: "queued" | "running" | "done" | "failed"; jobId: string; startedAt: string; error: string | null; summary: string | null } | null;
  sample?: boolean;
};

// ── The cradle's dial: the book's vital signs, in the workbench's Reading shape ─


/** Six readings for the Cockpit Dial on the Policy screen: the book at rest is the summary. */
export function cradleReadings(r: CradleResponse): Reading[] {
  const rd = r.readiness;
  const at = r.cradle?.ingestedAt ?? r.cradle?.startedAt ?? null;
  const base = { face: "site" as const, unit: "", change: null, trend: [], source: r.pack ? `${r.pack.label} pack ${r.pack.version}` : null, observedAt: at, evidence: null };
  if (!rd) {
    return ["Confirmed", "Contradictions", "Holes", "Kernels", "Proof", "Grounded"].map((label) => ({ ...base, id: label.toLowerCase(), label, condition: "not_connected" as const, state: "Not started", headline: null, facts: ["Start the cradle from an industry pack."] }));
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const proven = rd.policies - rd.unproven;
  return [
    { ...base, id: "confirmed", label: "Confirmed", condition: rd.criticalConfirmed === rd.critical && rd.critical > 0 ? "verified" : rd.confirmed ? "attention" : "unverified", state: `${pct(rd.confirmed, rd.policies)}%`, headline: `${rd.confirmed}/${rd.policies}`, facts: [`${rd.criticalConfirmed} of ${rd.critical} critical policies confirmed by the steward`, "Code confidence is not approval: every policy waits for a ruling."] },
    { ...base, id: "contradictions", label: "Contradictions", condition: rd.conflicts ? "attention" : "verified", state: rd.conflicts ? "Open" : "None open", headline: String(rd.conflicts), facts: [rd.conflicts ? "Each goes to its owner, who rules; the ruling becomes precedent." : "No open contradictions."] },
    { ...base, id: "holes", label: "Holes", condition: rd.criticalHoles ? "attention" : rd.holes ? "unverified" : "verified", state: rd.holes ? "Gaps" : "Complete", headline: String(rd.holes), facts: [`${rd.criticalHoles} in critical concepts`, "A hole is a lifecycle event no policy governs."] },
    { ...base, id: "kernels", label: "Kernels", condition: rd.needsKernel ? "attention" : "verified", state: rd.needsKernel ? "To build" : "Covered", headline: String(rd.needsKernel), facts: ["Critical policies needing a kernel or guard that isn't built yet.", `${rd.parametricShare}% of policies change as data, without code.`] },
    { ...base, id: "proof", label: "Proof", condition: rd.unproven ? (proven ? "attention" : "unverified") : "verified", state: `${pct(proven, rd.policies)}%`, headline: `${proven}/${rd.policies}`, facts: ["Policies with at least one Given/When/Then example."] },
    { ...base, id: "grounded", label: "Grounded", condition: r.cradle?.ingestedAt ? (rd.grounded ? "verified" : "attention") : "unverified", state: r.cradle?.ingestedAt ? `${pct(rd.grounded, rd.policies)}%` : "Not read", headline: `${rd.grounded}/${rd.policies}`, facts: [r.cradle?.ingestedAt ? "Policies cited to a file and line in the site's code." : "Ingest the site so the crew can find its policies in the code."] },
  ];
}
