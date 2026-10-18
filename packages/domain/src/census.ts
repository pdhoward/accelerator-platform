/**
 * The code census (gen2-crew.md §19.5, D50): what the codebase is made of, counted
 * on the exact candidate by Prove and recorded as evidence, so the Cockpit's
 * "312 functions, 41 components" is a measurement, not an estimate.
 *
 * The counts are static and deliberately simple (declarations and branch points
 * found by pattern, not a full parse), stable from run to run, and labelled as
 * such. They show size, shape and where complexity concentrates; they are not
 * a quality score.
 */

export type Hotspot = { path: string; branches: number; lines: number };

export type Census = {
  /** Source files counted (tracked, not generated, not declarations). */
  files: number;
  /** Non-blank source lines. */
  lines: number;
  /** Declared functions and arrow functions bound to a name, outside tests. */
  functions: number;
  /** React components: capitalised functions in .tsx/.jsx files, outside tests. */
  components: number;
  /** Next.js pages and route handlers (app/ page and route files, pages/ files). */
  routes: number;
  /** Test files. */
  tests: number;
  /** The files with the most branch points (if, loops, case, catch, &&, ||, ??), most first. */
  hotspots: Hotspot[];
};

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP = /(?:^|\/)(?:node_modules|\.next|dist|build|out|coverage|\.turbo|\.vercel|vendor)\//;

/** Whether a tracked path is source the census counts. */
export function isCensusSource(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  return SOURCE.test(p) && !p.endsWith(".d.ts") && !/\.min\.[cm]?js$/.test(p) && !SKIP.test(p);
}

export const isTestPath = (path: string) => {
  const p = path.replace(/\\/g, "/");
  return /(?:\.|\/)(?:test|spec)\.[cm]?[jt]sx?$/.test(p) || /(?:^|\/)(?:__tests__|tests?)\//.test(p);
};

const isRoute = (p: string) =>
  /(?:^|\/)app\/(?:.+\/)?(?:page|route)\.[cm]?[jt]sx?$/.test(p) || (/(?:^|\/)pages\/.+\.[cm]?[jt]sx?$/.test(p) && !/(?:^|\/)pages\/_(?:app|document|error)\./.test(p));

const FUNCTION_DECL = /\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(/g;
const ARROW_BINDING = /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=;]+)?=\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=;{]+)?=>/g;
const COMPONENT = /\bfunction\s+[A-Z][\w$]*\s*(?:<[^>]*>)?\s*\(|\b(?:const|let)\s+[A-Z][\w$]*\s*(?::[^=;]+)?=\s*(?:(?:React\.)?(?:memo|forwardRef)\s*\(\s*)?(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=;{]+)?=>|[a-z_$][\w$]*\s*=>)/g;
const BRANCH = /\bif\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b|&&|\|\||\?\?/g;

/** Comments and string contents would inflate the counts; blank them out first. */
function strip(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
}

const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

/** The census of a set of tracked files (non-source files are ignored). */
export function census(files: { path: string; text: string }[], topHotspots = 5): Census {
  const out: Census = { files: 0, lines: 0, functions: 0, components: 0, routes: 0, tests: 0, hotspots: [] };
  const spots: Hotspot[] = [];
  for (const f of files) {
    const path = f.path.replace(/\\/g, "/");
    if (!isCensusSource(path)) continue;
    out.files += 1;
    const lines = f.text.split(/\r?\n/).filter((l) => l.trim()).length;
    out.lines += lines;
    if (isRoute(path)) out.routes += 1;
    if (isTestPath(path)) {
      out.tests += 1;
      continue;
    }
    const code = strip(f.text);
    out.functions += count(FUNCTION_DECL, code) + count(ARROW_BINDING, code);
    if (/\.[jt]sx$/.test(path)) out.components += count(COMPONENT, code);
    const branches = count(BRANCH, code);
    if (branches) spots.push({ path, branches, lines });
  }
  out.hotspots = spots.sort((a, b) => b.branches - a.branches || a.path.localeCompare(b.path)).slice(0, topHotspots);
  return out;
}

/** Reads a census back from an evidence row's detail, or null when it isn't one. */
export function readCensus(detail: Record<string, unknown>): Census | null {
  const n = (k: string) => (typeof detail[k] === "number" && Number.isFinite(detail[k]) ? (detail[k] as number) : null);
  const keys = ["files", "lines", "functions", "components", "routes", "tests"] as const;
  if (keys.some((k) => n(k) == null)) return null;
  const hotspots = Array.isArray(detail.hotspots)
    ? (detail.hotspots as unknown[]).flatMap((h) => {
        const o = (h ?? {}) as Record<string, unknown>;
        return typeof o.path === "string" && typeof o.branches === "number" ? [{ path: o.path, branches: o.branches, lines: typeof o.lines === "number" ? o.lines : 0 }] : [];
      })
    : [];
  return { files: n("files")!, lines: n("lines")!, functions: n("functions")!, components: n("components")!, routes: n("routes")!, tests: n("tests")!, hotspots };
}
