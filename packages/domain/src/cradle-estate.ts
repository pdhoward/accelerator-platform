/**
 * The first technology adapter beside TypeScript (gen3-cradle.md §11.2–11.3,
 * G3-D19/D20): reading a mainframe estate. A repository's files are sorted by
 * the role they play (program, copybook, job, screen, …) and cut into slices
 * small enough for one extractor each; a reconciling pass then finds what no
 * single slice can see (two programs implementing one rule differently, holes
 * against the pack). Pure: the runner lists the files and runs the agents.
 */

import type { Conflict, IngestCandidate, IngestReport, Pack } from "./cradle";

export type FileRole = "program" | "copybook" | "job" | "schedule" | "screen" | "transaction" | "data_definition" | "data" | "other";
export type EstateKind = "cobol" | "web";
export type Slice = { id: string; title: string; files: string[]; lines: number };
export type Estate = { kind: EstateKind; counts: Partial<Record<FileRole, number>>; slices: Slice[]; copybookDirs: string[] };

/** Folders that name a kind of member rather than a module (app/cbl, app/x-module/jcl, …). */
const KIND_DIRS = new Set(["cbl", "cob", "cobol", "cpy", "cpy-bms", "copy", "copybook", "copybooks", "bms", "jcl", "proc", "procs", "csd", "ddl", "dcl", "ims", "ctl", "scheduler", "asm", "maclib", "data", "src"]);

export function roleOf(path: string): FileRole {
  const p = path.toLowerCase();
  if (/(^|\/)data\//.test(p) || /\.(ps|dat|ebcdic)$/.test(p)) return "data";
  if (/\.(cbl|cob)$/.test(p)) return "program";
  if (/\.(cpy|copy)$/.test(p) || /(^|\/)cpy(-bms)?\//.test(p)) return "copybook";
  if (/\.(jcl|prc|proc)$/.test(p)) return "job";
  if (/\.(ca7|controlm)$/.test(p) || /(^|\/)scheduler\//.test(p)) return "schedule";
  if (/\.bms$/.test(p)) return "screen";
  if (/\.csd$/.test(p)) return "transaction";
  if (/\.(ddl|dcl|dbd|psb)$/.test(p) || /(^|\/)(ddl|dcl|ims)\//.test(p)) return "data_definition";
  return "other";
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** The module a file belongs to: the folder above its kind folder (app/cbl/X.cbl → app). */
export function moduleOf(path: string): string {
  const dir = dirOf(path);
  return KIND_DIRS.has(nameOf(dir).toLowerCase()) ? dirOf(dir) : dir;
}

const LIMITS = { programs: 8, lines: 6000, small: 2500 };
/** Examples, docs and tooling beside the application are not the application. */
const NOT_APP = /(^|\/)(samples?|examples?|docs?|diagrams|scripts|tests?)\//i;

/**
 * Sort the estate and cut it into slices. Programs are taken in name order
 * (so batch CB* and online CO* stay together), at most 8 or about 6,000 lines
 * to a slice; each module's jobs and schedules make one slice, its screens,
 * transactions and data definitions another. Copybooks and data are never a
 * slice: extractors read the copybooks their programs COPY.
 */
export function estateOf(files: { path: string; lines: number }[]): Estate {
  const counts: Partial<Record<FileRole, number>> = {};
  for (const f of files) {
    const r = roleOf(f.path);
    counts[r] = (counts[r] ?? 0) + 1;
  }
  const web = files.filter((f) => /\.(?:[cm]?[jt]sx?|py|rb|php|go)$/i.test(f.path)).length;
  const kind: EstateKind = (counts.program ?? 0) >= 3 && (counts.program ?? 0) >= web ? "cobol" : "web";
  if (kind === "web") return { kind, counts, slices: [], copybookDirs: [] };

  const app = files.filter((f) => !NOT_APP.test(f.path));
  const modules = [...new Set(app.filter((f) => ["program", "job", "schedule", "screen", "transaction", "data_definition"].includes(roleOf(f.path))).map((f) => moduleOf(f.path)))].sort();
  const label = (m: string) => (m ? nameOf(m) : "root");
  const slices: Slice[] = [];
  for (const m of modules) {
    const mine = app.filter((f) => moduleOf(f.path) === m).sort((a, b) => nameOf(a.path).localeCompare(nameOf(b.path)));
    const programs = mine.filter((f) => roleOf(f.path) === "program");
    const chunks: (typeof programs)[] = [];
    for (const f of programs) {
      const cur = chunks.at(-1);
      if (cur && cur.length < LIMITS.programs && cur.reduce((n, x) => n + x.lines, 0) + f.lines <= LIMITS.lines) cur.push(f);
      else chunks.push([f]);
    }
    chunks.forEach((c, i) => {
      const range = c.length > 1 ? `${stem(c[0]!.path)}–${stem(c.at(-1)!.path)}` : stem(c[0]!.path);
      slices.push(slice(`${label(m)} · programs ${i + 1}/${chunks.length} (${range})`, c));
    });
    const flow = mine.filter((f) => ["job", "schedule"].includes(roleOf(f.path)));
    const surface = mine.filter((f) => ["screen", "transaction", "data_definition"].includes(roleOf(f.path)));
    const lines = (fs: typeof mine) => fs.reduce((n, f) => n + f.lines, 0);
    // A small module's jobs and screens are one slice; a large one's are two.
    if (flow.length && surface.length && lines(flow) + lines(surface) <= LIMITS.small) slices.push(slice(`${label(m)} · batch flow, screens and data definitions`, [...flow, ...surface]));
    else {
      if (flow.length) slices.push(slice(`${label(m)} · batch flow (jobs and schedule)`, flow));
      if (surface.length) slices.push(slice(`${label(m)} · screens, transactions and data definitions`, surface));
    }
  }
  const copybookDirs = [...new Set(app.filter((f) => roleOf(f.path) === "copybook").map((f) => dirOf(f.path)))].sort();
  return { kind, counts, slices: slices.map((s, i) => ({ ...s, id: `slice-${i + 1}` })), copybookDirs };
}

const stem = (p: string) => nameOf(p).replace(/\.[^.]+$/, "");
const slice = (title: string, fs: { path: string; lines: number }[]): Slice => ({ id: "", title, files: fs.map((f) => f.path), lines: fs.reduce((n, f) => n + f.lines, 0) });

/** How to read a mainframe estate, added to the extractor's instruction for one slice. */
export function cobolSliceGuidance(estate: Estate, s: Slice, index: number): string {
  return `This is a mainframe estate: COBOL programs, copybooks, JCL, CICS screens (BMS) and transaction definitions (CSD)${estate.counts.data_definition ? ", with DB2/IMS data definitions" : ""}. Read it like one:
- Business rules live in the PROCEDURE DIVISION: IF and EVALUATE conditions, COMPUTE statements, and the values they compare against.
- A program's records are defined in copybooks (COPY name). Read the copybooks your programs COPY; they are in ${estate.copybookDirs.join(", ") || "the copybook folders"}. Level-88 names are the allowed states of a field (for example an account's status): treat them as enumerations.
- PIC clauses are numeric semantics: decimal places, signs and ROUNDED are policy. Put them in parameters.
- JCL and scheduler files say when batch programs run and in what order: a rule may only apply when its job runs.
- Messages a screen shows a user are surfaces.
- Cite each source as path and line, and start the quote with the paragraph name (for example "1300-COMPUTE-INTEREST: COMPUTE WS-MONTHLY-INT = ...").
- Never open data files (EBCDIC or sample data).

You are extractor ${index + 1} of ${estate.slices.length}. Your slice: ${s.title}. Read only these files, plus the copybooks they COPY:
${s.files.map((f) => `- ${f}`).join("\n")}
Other extractors read the rest of the estate. Report only what your slice shows. Report contradictions only within your slice, and leave holes to the reconciliation step (skip the gapfinder line).`;
}

/**
 * One report from many slices: a pack policy found twice keeps one candidate
 * with every source (the reconciler compares their values); a site policy is
 * the same when its title is.
 */
export function mergeReports(reports: IngestReport[]): IngestReport {
  const byKey = new Map<string, IngestCandidate>();
  for (const r of reports) {
    for (const c of r.candidates) {
      const k = c.packKey ? `pack:${c.packKey}` : `site:${c.title.trim().toLowerCase()}`;
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, { ...c, sources: [...c.sources], surfaces: [...(c.surfaces ?? [])] });
      else {
        cur.sources.push(...c.sources.filter((s) => !cur.sources.some((x) => x.path === s.path && x.lines === s.lines)));
        cur.surfaces = [...new Set([...(cur.surfaces ?? []), ...(c.surfaces ?? [])])];
      }
    }
  }
  const seen = new Set<string>();
  const conflicts = reports.flatMap((r) => r.conflicts).filter((c) => {
    const k = [...c.keys].sort().join("|");
    return seen.has(k) ? false : (seen.add(k), true);
  });
  return { summary: reports.map((r) => r.summary).filter(Boolean).join(" "), candidates: [...byKey.values()], conflicts, filesRead: reports.reduce((n, r) => n + (r.filesRead ?? 0), 0) };
}

/** The reconciling pass: what no single slice can see. */
export function reconcileInstruction(pack: Pack, merged: IngestReport): string {
  const list = merged.candidates.map((c) => `- ${c.packKey ?? "(site)"} | ${c.title} | ${c.statement} | ${JSON.stringify(c.parameters)} | ${c.sources.map((s) => `${s.path}${s.lines ? `:${s.lines}` : ""}`).join(", ")}`).join("\n");
  return `You are the crew's Clerk and Gap Finder, reconciling a system that several extractors read in parts (slices of a mainframe estate, or separate code repositories such as a web app, an API server and an auth server; a cited path may start with its repository's name). You may open files to check a claim; never change anything.

The ${pack.label} pack's concepts and events:
${pack.concepts.map((c) => `- ${c.key}: ${c.events.join(", ")}`).join("\n")}

The pack's policies and their regulations:
${pack.policies.map((p) => `- ${p.key} [${p.concept}/${p.event}] ${p.statement}${p.regulation ? ` (${p.regulation})` : ""}`).join("\n")}

What the extractors found (key | title | statement | parameters | sources):
${list}

Find:
1. Implementation against implementation: two programs that carry out the same rule differently (different values, rounding, order or conditions).
2. Code against regulation: a found policy that breaks a pack policy's regulation.
3. Holes: pack events no found policy governs.

Narrate each finding on its own line, in exactly one of these forms:
clerk> CONFLICT <one policy> vs <the other>
gapfinder> holes: <event> · <event>

Finish with exactly one fenced \`\`\`json block: {"conflicts": [{"keys": ["<pack key or site title>", "<pack key or site title>"], "why": "...", "kind": "policy" | "regulation" | "surface"}]}`;
}

/** The reconciler's conflicts, read leniently; a bad answer adds none rather than failing the ingest. */
export function readReconcile(text: string): { keys: string[]; why: string; kind?: Conflict["kind"] }[] {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].at(-1)?.[1];
  if (!fenced) return [];
  try {
    const o = JSON.parse(fenced) as { conflicts?: unknown };
    return (Array.isArray(o.conflicts) ? o.conflicts : []).flatMap((c: { keys?: unknown; why?: unknown; kind?: unknown }) => {
      const keys = Array.isArray(c?.keys) ? c.keys.filter((k): k is string => typeof k === "string" && !!k.trim()) : [];
      const why = typeof c?.why === "string" ? c.why.trim() : "";
      const kind = c?.kind === "regulation" || c?.kind === "surface" ? c.kind : "policy";
      return keys.length >= 1 && why ? [{ keys, why, kind }] : [];
    });
  } catch {
    return [];
  }
}
