/**
 * The policy graph as a picture, at any moment in its history (gen3-cradle.md
 * §2, §12). Nothing in the graph is overwritten: every policy version has an
 * effective range and every contradiction keeps when it was found and ruled,
 * so the graph as it stood at any instant is an exact query. Pure: the API
 * sends the history once and the console scrubs through it.
 */

import { assembleBook, findings, type Alignment, type BookPolicy, type Conflict, type Pack, type SitePolicy } from "./cradle";

/** One stored version of a site policy, with the range it was in force. */
export type PolicyVersion = { key: string; version: number; from: string; to: string | null; by: string | null; body: SitePolicy };
export type HistoryConflict = Conflict & { createdAt: string; ruledAt: string | null; ruledBy?: string | null };

/** Everything needed to draw the graph at any moment. */
export type CradleHistory = {
  pack: Pack;
  startedAt: string;
  versions: PolicyVersion[];
  conflicts: HistoryConflict[];
  alignments: Alignment[];
  sample?: boolean;
};

export type GraphNodeKind = "concept" | "policy" | "kernel" | "hole" | "decision";
export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Policies: the book row as of the moment. */
  policy?: BookPolicy;
  decision?: Alignment;
  kernelStatus?: string;
};
export type GraphEdgeKind = "governs" | "runs_through" | "conflicts_with" | "decides" | "missing";
export type GraphEdge = { id: string; source: string; target: string; kind: GraphEdgeKind; open?: boolean; why?: string; ruling?: string | null };

export type GraphView = { asOf: string; nodes: GraphNode[]; edges: GraphEdge[] };

/** A moment worth stopping at on the timeline: the start, each ingest, each ruling and each decision. */
export type GraphMoment = { at: string; kind: "start" | "ingest" | "ruling" | "decision"; label: string };

const inForce = (v: PolicyVersion, at: string) => v.from <= at && (v.to == null || at < v.to);

/** The site's layer as it stood at `asOf`: for each key, the version in force then. */
export function layerAt(versions: PolicyVersion[], asOf: string): SitePolicy[] {
  const byKey = new Map<string, PolicyVersion>();
  for (const v of versions) if (inForce(v, asOf) && (!byKey.has(v.key) || byKey.get(v.key)!.version < v.version)) byKey.set(v.key, v);
  return [...byKey.values()].map((v) => ({ ...v.body, key: v.key, version: v.version }));
}

/** The graph at a moment. Before the cradle started there is nothing to draw. */
export function graphAt(h: CradleHistory, asOf: string): GraphView {
  if (asOf < h.startedAt) return { asOf, nodes: [], edges: [] };
  const { pack } = h;
  const book = assembleBook(pack, layerAt(h.versions, asOf));
  const conflicts = h.conflicts
    .filter((c) => c.createdAt <= asOf)
    .map((c): Conflict => (c.ruledAt && c.ruledAt <= asOf ? { ...c, status: "resolved" } : { ...c, status: "open", ruling: null }));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const keys = new Set(book.map((p) => p.key));

  for (const c of pack.concepts) nodes.push({ id: `concept:${c.key}`, kind: "concept", label: c.label });
  const kernels = new Set<string>();
  for (const p of book) {
    nodes.push({ id: p.key, kind: "policy", label: p.title, policy: p });
    edges.push({ id: `${p.key}>concept`, source: p.key, target: `concept:${p.concept}`, kind: "governs" });
    if (p.kernel) {
      kernels.add(p.kernel);
      edges.push({ id: `${p.key}>kernel`, source: p.key, target: `kernel:${p.kernel}`, kind: "runs_through" });
    }
  }
  // Policies the crew found can name a concept or kernel the pack doesn't have (e.g. "other"): they get a node of their own.
  for (const c of new Set(book.map((p) => p.concept))) {
    if (!pack.concepts.some((x) => x.key === c)) nodes.push({ id: `concept:${c}`, kind: "concept", label: c.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase()) });
  }
  for (const k of kernels) {
    const known = pack.kernels.find((x) => x.key === k);
    nodes.push({ id: `kernel:${k}`, kind: "kernel", label: known?.label ?? k, kernelStatus: known?.status ?? "planned" });
  }
  // A hole is a lifecycle event of a concept that no policy governs: drawn as a ghost node on its concept.
  for (const f of findings(pack, book, conflicts).filter((f) => f.kind === "hole")) {
    const id = `hole:${f.at!.concept}/${f.at!.event}`;
    nodes.push({ id, kind: "hole", label: f.at!.event.replace(/_/g, " ") });
    edges.push({ id: `${id}>concept`, source: id, target: `concept:${f.at!.concept}`, kind: "missing" });
  }
  for (const c of conflicts) {
    const [a, b] = c.keys;
    if (a && b && keys.has(a) && keys.has(b)) edges.push({ id: `conflict:${c.id}`, source: a, target: b, kind: "conflicts_with", open: c.status === "open", why: c.why, ruling: c.ruling ?? null });
  }
  for (const d of h.alignments.filter((d) => d.at <= asOf)) {
    nodes.push({ id: `decision:${d.id}`, kind: "decision", label: d.sentence, decision: d });
    for (const k of d.keys.filter((k) => keys.has(k))) edges.push({ id: `decision:${d.id}>${k}`, source: `decision:${d.id}`, target: k, kind: "decides" });
  }
  return { asOf, nodes, edges };
}

/**
 * The timeline's stops. An ingest writes many versions at once; versions by the
 * same hand within a minute are one moment.
 */
export function graphMoments(h: CradleHistory): GraphMoment[] {
  const out: GraphMoment[] = [{ at: h.startedAt, kind: "start", label: `Cradle started from the ${h.pack.label} pack` }];
  const groups = new Map<string, { at: string; by: string; n: number }>();
  for (const v of h.versions) {
    const g = `${v.by ?? ""}|${v.from.slice(0, 16)}`;
    const cur = groups.get(g);
    // The stop is the group's last change, so it shows the whole group.
    if (cur) Object.assign(cur, { n: cur.n + 1, at: v.from > cur.at ? v.from : cur.at });
    else groups.set(g, { at: v.from, by: v.by ?? "Someone", n: 1 });
  }
  for (const g of groups.values()) {
    const ingest = g.by === "Policy Extractor";
    out.push({ at: g.at, kind: ingest ? "ingest" : "ruling", label: ingest ? `Ingest: ${g.n} ${g.n === 1 ? "policy" : "policies"} found or updated` : `${g.by} ruled on ${g.n} ${g.n === 1 ? "policy" : "policies"}` });
  }
  for (const c of h.conflicts.filter((c) => c.ruledAt)) out.push({ at: c.ruledAt!, kind: "ruling", label: `Contradiction ruled: "${c.ruling ?? ""}"` });
  for (const d of h.alignments) out.push({ at: d.at, kind: "decision", label: `Sent to the crew: "${d.sentence}"` });
  return out.filter((m) => m.at >= h.startedAt).sort((a, b) => a.at.localeCompare(b.at));
}

/** Every version a policy has had, newest first: the history behind one node. */
export function policyHistory(h: CradleHistory, key: string): PolicyVersion[] {
  return h.versions.filter((v) => v.key === key).sort((a, b) => b.version - a.version);
}

/** Roll a policy back: the old version's content becomes the next version. History is never rewritten. */
export function restoreVersion(current: SitePolicy | undefined, old: PolicyVersion, by: string, at: string): SitePolicy {
  return { ...old.body, key: old.key, version: Math.max(current?.version ?? 0, old.version) + 1, ruledBy: by, ruledAt: at, reason: `Restored to version ${old.version}.` };
}
