/**
 * The code map (gen3-cradle.md §11.3.1, B16, B28): one language-neutral graph
 * that every technology pack emits, so everything above it (policy
 * extraction, "applies when" (B25), batch order (B24), the data dictionary
 * (B3)) never knows which language a system is written in. Adding a language
 * is writing a technology pack that fills this map; nothing upstream changes.
 *
 * Pure data and pure functions: the runner reads files, a pack parses them
 * into a part of the map, and the parts are merged and their names resolved
 * here. Every node and edge carries a citation (file and lines).
 */

/** How far a technology pack reads a system (§11.3.1): stated per pack, never claimed beyond its answer key. */
export type Level = 0 | 1 | 2 | 3 | 4;
export const LEVELS: Record<Level, string> = {
  0: "read as text by the model",
  1: "classified, sliced and cited",
  2: "parsed into the code map",
  3: "entry points, call chains, data flow and conditions",
  4: "runtime behavior recorded and replayed",
};

export type Cite = { file: string; line: number; endLine?: number };

/** What a node is: one vocabulary for every language (a COBOL paragraph and a TypeScript function are both units). */
export type UnitKind =
  | "program" // a COBOL program, a module, a script
  | "paragraph" // a COBOL paragraph or section, a function, a method
  | "copybook" // a COBOL copybook, an included header, a shared type file
  | "job" // a JCL job, a scheduled workflow
  | "step" // a JCL step, a workflow step
  | "screen" // a BMS map, a page, a component
  | "class";

export type CodeUnit = { id: string; kind: UnitKind; name: string; tech: string; cite: Cite; parent?: string };

/** Where execution can start from outside the system: the roots of every call chain. */
export type EntryKind = "transaction" | "job_step" | "route" | "handler" | "schedule" | "main";
export type EntryPoint = { id: string; kind: EntryKind; name: string; unit: string; cite: Cite };

/** Where data lives: VSAM files, DB2 tables, queues, an ORM model, an API. */
export type StoreKind = "file" | "table" | "queue" | "dataset" | "api";
export type DataStore = { id: string; kind: StoreKind; name: string; cite?: Cite };

/**
 * How control and data move. `to` names a unit or store; until resolved it is
 * the name as written. A target held in a variable (CALL WS-PGM, XCTL
 * PROGRAM(CDEMO-TO-PROGRAM), a route table) is `dynamic`: resolved by data
 * flow when a pack can (L3), otherwise marked data-driven, never guessed.
 */
export type EdgeKind =
  | "calls" // CALL, a function call
  | "transfers" // CICS XCTL: control passes and doesn't return
  | "links" // CICS LINK: control returns
  | "performs" // PERFORM, a local call
  | "includes" // COPY, import
  | "runs" // a JCL step runs a program
  | "next" // a job step or batch job that follows another (B24)
  | "starts" // CICS START, RETURN TRANSID, an enqueued job
  | "reads"
  | "writes"
  | "updates"
  | "deletes"
  | "shows"; // a program sends a screen

export type Edge = {
  from: string;
  to: string;
  kind: EdgeKind;
  cite: Cite;
  /** The target is named in data, not literally (resolved: the values it can take, when a pack proved them). */
  dynamic?: { via: string; resolved: string[] };
  /** The condition this edge sits under, as written, when a pack reads it (L3, B25). */
  when?: string;
};

export type CodeMap = {
  /** The technology packs that contributed, with their levels. */
  technologies: { id: string; level: Level }[];
  units: CodeUnit[];
  entries: EntryPoint[];
  stores: DataStore[];
  edges: Edge[];
};

export type CodeMapPart = Partial<Omit<CodeMap, "technologies">> & { technology: { id: string; level: Level } };

const key = (s: string) => s.trim().toUpperCase();

/**
 * Merge the packs' parts into one map, and resolve edges by name across them:
 * a JCL step's "runs CBTRN02C" meets the COBOL pack's program CBTRN02C, a
 * CICS transaction meets its program. Duplicate nodes (the same id from two
 * packs) keep the first. Names that match nothing stay as written, so the map
 * shows what the estate calls but doesn't contain (an IBM utility, a missing
 * program).
 */
export function mergeMaps(parts: CodeMapPart[]): CodeMap {
  const units = new Map<string, CodeUnit>();
  const entries = new Map<string, EntryPoint>();
  const stores = new Map<string, DataStore>();
  const edges: Edge[] = [];
  for (const p of parts) {
    for (const u of p.units ?? []) if (!units.has(u.id)) units.set(u.id, u);
    for (const e of p.entries ?? []) if (!entries.has(e.id)) entries.set(e.id, e);
    for (const s of p.stores ?? []) if (!stores.has(s.id)) stores.set(s.id, s);
    edges.push(...(p.edges ?? []));
  }
  // Programs, jobs and screens are found by name; paragraphs only inside their program (ids carry the program).
  const byName = new Map<string, string>();
  for (const u of units.values()) if (u.kind !== "paragraph" && u.kind !== "step") byName.set(key(u.name), byName.get(key(u.name)) ?? u.id);
  for (const s of stores.values()) byName.set(key(s.name), byName.get(key(s.name)) ?? s.id);
  const resolve = (to: string) => (units.has(to) || stores.has(to) ? to : byName.get(key(to)) ?? to);
  const resolved = edges.map((e) => ({
    ...e,
    to: resolve(e.to),
    ...(e.dynamic && { dynamic: { via: e.dynamic.via, resolved: e.dynamic.resolved.map(resolve) } }),
  }));
  const seen = new Set<string>();
  const unique = resolved.filter((e) => {
    const k = `${e.from}|${e.kind}|${e.to}|${e.cite.file}:${e.cite.line}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return {
    technologies: parts.map((p) => p.technology).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i),
    units: [...units.values()],
    entries: [...entries.values()],
    stores: [...stores.values()],
    edges: unique,
  };
}

/** What the map knows and doesn't, for the ingest log and the Policy Walk: counts, and the targets it couldn't resolve. */
export function mapSummary(m: CodeMap): { units: number; entries: number; stores: number; edges: number; unresolved: string[]; dataDriven: number } {
  const known = new Set([...m.units.map((u) => u.id), ...m.stores.map((s) => s.id)]);
  const unresolved = [...new Set(m.edges.filter((e) => !e.dynamic && !known.has(e.to)).map((e) => e.to))].sort();
  return { units: m.units.length, entries: m.entries.length, stores: m.stores.length, edges: m.edges.length, unresolved, dataDriven: m.edges.filter((e) => e.dynamic && !e.dynamic.resolved.length).length };
}

/**
 * Every path from the map's entry points to a unit (B25's "reached from"),
 * following calls, transfers, links, performs, runs and starts, without
 * cycles. Data-driven edges with resolved targets are followed; unresolved
 * ones end a path and are reported, so a missing hop is visible, not hidden.
 */
export function pathsTo(m: CodeMap, target: string, limit = 50): { paths: Edge[][]; gaps: Edge[] } {
  const flow: EdgeKind[] = ["calls", "transfers", "links", "performs", "runs", "starts"];
  const into = new Map<string, Edge[]>();
  for (const e of m.edges) {
    if (!flow.includes(e.kind)) continue;
    for (const to of e.dynamic ? e.dynamic.resolved : [e.to]) into.set(to, [...(into.get(to) ?? []), { ...e, to }]);
  }
  const roots = new Set(m.entries.map((e) => e.unit));
  const paths: Edge[][] = [];
  const gaps = m.edges.filter((e) => e.dynamic && !e.dynamic.resolved.length && flow.includes(e.kind));
  const walk = (at: string, path: Edge[], seen: Set<string>) => {
    if (paths.length >= limit) return;
    if (roots.has(at) && path.length) paths.push([...path].reverse());
    for (const e of into.get(at) ?? []) {
      if (seen.has(e.from)) continue;
      walk(e.from, [...path, e], new Set([...seen, e.from]));
    }
  };
  if (roots.has(target)) paths.push([]);
  walk(target, [], new Set([target]));
  return { paths, gaps };
}
