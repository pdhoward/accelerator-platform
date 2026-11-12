import type { CodeMapPart, Level } from "./code-map";

/**
 * Technology packs (gen3-cradle.md §11.3.1, §15, B28): the second axis beside
 * industry packs. An industry pack answers "what business is this?"; a
 * technology pack answers "what is it built with?". Every ingest is one
 * industry pack × the technology packs the census detects.
 *
 * Two layers, because technologies stack: language packs know syntax (COBOL,
 * JCL, TypeScript, Java…); framework and runtime packs know what the code
 * means at run time (CICS transactions, JCL schedules, Next.js routes, Spring
 * controllers…) and sit on a language pack.
 *
 * Each pack states its level honestly (code-map.ts LEVELS). A pack with a
 * `map` function parses its files into the code map (L2 and up); the others
 * are read by the model (L0) or classified and sliced (L1).
 */

export type TechLayer = "language" | "framework";

export type SourceFile = { path: string; text: string };

export type TechnologyPack = {
  id: string;
  label: string;
  layer: TechLayer;
  level: Level;
  /** Framework packs: the language packs they sit on. */
  on?: string[];
  /** The files this pack reads, by path. */
  claims: (path: string) => boolean;
  /** Framework packs found by content, not by file name (EXEC CICS inside COBOL). Checked on the files of the packs it sits on. */
  signature?: RegExp;
  /** What its census counts, in its own words (programs, jobs, routes…). */
  measures: string;
  /** L2 and up: parse the claimed files into a part of the code map. */
  map?: (files: SourceFile[]) => CodeMapPart;
};

const ext = (...e: string[]) => {
  const re = new RegExp(`\\.(?:${e.join("|")})$`, "i");
  return (p: string) => re.test(p);
};
const SKIP = /(?:^|\/)(?:node_modules|\.next|dist|build|out|coverage|vendor|\.git)\//;

/** Every technology pack the platform knows, at the level built today (2026-11-12). Order: mainframe family, then modern languages, then frameworks. */
export const TECHNOLOGIES: TechnologyPack[] = [
  { id: "cobol", label: "COBOL", layer: "language", level: 1, claims: (p) => ext("cbl", "cob", "cpy", "copy")(p) || /(^|\/)cpy(-bms)?\//i.test(p), measures: "programs and copybooks" },
  { id: "jcl", label: "JCL", layer: "language", level: 1, claims: ext("jcl", "prc", "proc"), measures: "jobs and procedures" },
  { id: "hlasm", label: "Assembler (HLASM)", layer: "language", level: 0, claims: (p) => ext("asm", "mac", "mlc")(p) || /(^|\/)(asm|maclib)\//i.test(p), measures: "modules and macros" },
  { id: "cics", label: "CICS", layer: "framework", level: 1, on: ["cobol"], claims: ext("bms", "csd"), signature: /\bEXEC\s+CICS\b/i, measures: "screens, transactions and programs that use CICS" },
  { id: "db2", label: "DB2", layer: "framework", level: 1, on: ["cobol"], claims: (p) => ext("ddl", "dcl")(p) || /(^|\/)(ddl|dcl)\//i.test(p), signature: /\bEXEC\s+SQL\b/i, measures: "table definitions and programs with embedded SQL" },
  { id: "ims", label: "IMS", layer: "framework", level: 1, on: ["cobol"], claims: (p) => ext("dbd", "psb")(p) || /(^|\/)ims\//i.test(p), signature: /\bEXEC\s+DLI\b|\bCBLTDLI\b/i, measures: "database and program definitions" },
  { id: "mq", label: "IBM MQ", layer: "framework", level: 0, on: ["cobol"], claims: () => false, signature: /\bMQ(?:OPEN|PUT|GET|CONN)\b/, measures: "programs that use queues" },
  { id: "scheduler", label: "Batch scheduler (CA-7, Control-M)", layer: "framework", level: 1, on: ["jcl"], claims: (p) => ext("ca7", "controlm")(p) || /(^|\/)scheduler\//i.test(p), measures: "schedules" },
  { id: "typescript", label: "TypeScript and JavaScript", layer: "language", level: 0, claims: (p) => ext("ts", "tsx", "js", "jsx", "mjs", "cjs")(p) && !p.endsWith(".d.ts"), measures: "modules and functions" },
  { id: "python", label: "Python", layer: "language", level: 0, claims: ext("py"), measures: "modules and functions" },
  { id: "java", label: "Java", layer: "language", level: 0, claims: ext("java"), measures: "classes and methods" },
  { id: "csharp", label: "C#", layer: "language", level: 0, claims: ext("cs"), measures: "classes and methods" },
  { id: "php", label: "PHP", layer: "language", level: 0, claims: ext("php"), measures: "files and functions" },
  { id: "go", label: "Go", layer: "language", level: 0, claims: ext("go"), measures: "packages and functions" },
  { id: "ruby", label: "Ruby", layer: "language", level: 0, claims: ext("rb"), measures: "files and methods" },
  { id: "c", label: "C and C++", layer: "language", level: 0, claims: ext("c", "h", "cc", "cpp", "hpp"), measures: "files and functions" },
  { id: "sql", label: "SQL", layer: "language", level: 0, claims: ext("sql"), measures: "scripts and tables" },
  { id: "html", label: "HTML and CSS", layer: "language", level: 0, claims: ext("html", "htm", "css", "scss"), measures: "pages and stylesheets" },
  { id: "react", label: "React", layer: "framework", level: 0, on: ["typescript"], claims: ext("tsx", "jsx"), measures: "components" },
  { id: "nextjs", label: "Next.js", layer: "framework", level: 0, on: ["typescript"], claims: (p) => /(^|\/)next\.config\.[cm]?[jt]s$/.test(p) || /(^|\/)app\/(.+\/)?(page|route|layout)\.[jt]sx?$/.test(p), measures: "pages and route handlers" },
  { id: "django", label: "Django", layer: "framework", level: 0, on: ["python"], claims: (p) => /(^|\/)(manage|settings|urls)\.py$/.test(p), measures: "views and URL routes" },
  { id: "spring", label: "Spring", layer: "framework", level: 0, on: ["java"], claims: () => false, signature: /@(?:RestController|Controller|SpringBootApplication)\b/, measures: "controllers" },
];

export type Detected = { id: string; label: string; layer: TechLayer; level: Level; files: number; lines: number; on?: string[] };

/**
 * Which technology packs a system needs (step 2 of §15.4): by path for every
 * pack, and by content for framework packs that live inside another
 * language's files (CICS, DB2, IMS and MQ inside COBOL; Spring inside Java).
 * `texts` is optional: without it only path-claimed packs are found.
 * Files no pack claims are counted, so an unknown technology is flagged
 * rather than silently skipped.
 */
export function detectTechnologies(
  files: { path: string; lines: number }[],
  texts?: (path: string) => string | null,
): { detected: Detected[]; unclaimed: { ext: string; files: number }[] } {
  const src = files.filter((f) => !SKIP.test(f.path.replace(/\\/g, "/")));
  const out = new Map<string, Detected>();
  const add = (t: TechnologyPack, f: { lines: number }) => {
    const d = out.get(t.id) ?? { id: t.id, label: t.label, layer: t.layer, level: t.level, files: 0, lines: 0, ...(t.on && { on: t.on }) };
    d.files++;
    d.lines += f.lines;
    out.set(t.id, d);
  };
  const claimed = new Set<string>();
  for (const f of src) {
    for (const t of TECHNOLOGIES) {
      if (t.claims(f.path)) {
        add(t, f);
        claimed.add(f.path);
      }
    }
  }
  if (texts) {
    for (const t of TECHNOLOGIES.filter((x) => x.signature && x.on)) {
      const hosts = TECHNOLOGIES.filter((h) => t.on!.includes(h.id));
      for (const f of src.filter((x) => hosts.some((h) => h.claims(x.path)) && !t.claims(x.path))) {
        const text = texts(f.path);
        if (text && t.signature!.test(text)) add(t, f);
      }
    }
  }
  const rest = new Map<string, number>();
  for (const f of src) {
    if (claimed.has(f.path)) continue;
    const m = /\.([a-z0-9]+)$/i.exec(f.path);
    if (!m || /^(md|txt|png|jpe?g|gif|svg|ico|json|ya?ml|toml|lock|ps|dat|ebcdic|csv|sh|bat|cmd|ctl|xml|pdf|zip|gz|tar|gitkeep|gitignore|gitattributes|example|env|editorconfig|prettierrc|license)$/i.test(m[1]!)) continue;
    rest.set(m[1]!.toLowerCase(), (rest.get(m[1]!.toLowerCase()) ?? 0) + 1);
  }
  return {
    detected: [...out.values()].sort((a, b) => b.files - a.files),
    unclaimed: [...rest.entries()].map(([e, n]) => ({ ext: e, files: n })).sort((a, b) => b.files - a.files),
  };
}

/** One line for the ingest log: "COBOL (L1) 44 files · JCL (L1) 61 files · CICS on COBOL (L1) 21 files…". */
export function technologiesLine(d: Detected[], unclaimed: { ext: string; files: number }[]): string {
  const parts = d.map((t) => `${t.label}${t.on ? ` on ${t.on.join("+")}` : ""} (L${t.level}) ${t.files} files`);
  const rest = unclaimed.length ? ` · not covered by any technology pack: ${unclaimed.slice(0, 5).map((u) => `.${u.ext} ×${u.files}`).join(", ")}` : "";
  return `${parts.join(" · ") || "no known technology"}${rest}`;
}
