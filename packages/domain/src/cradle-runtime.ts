/**
 * The book a running app reads (gen3-cradle.md §1.4, backlog B4): the
 * policies in force and the steward's rulings, in the smallest shape an app
 * agent grounds on. Pure: the API assembles it from the cradle, the app reads
 * it over a site token. `version` changes whenever anything in it does, so an
 * app can recompile its projections exactly when the rules change.
 */

import type { CradleResponse } from "./cradle";

export type RuntimePolicy = {
  key: string;
  title: string;
  statement: string;
  concept: string;
  event: string;
  criticality: string;
  parameters: Record<string, unknown>;
  kernel: string | null;
  /** confirmed by the steward, or still as the crew extracted it */
  status: "confirmed" | "unreviewed" | "disputed";
  version: number;
};

export type RuntimeRuling = { id: string; keys: string[]; ruling: string };

export type RuntimeBook = {
  site: { id: string; name: string };
  pack: { id: string; version: string } | null;
  version: string;
  at: string;
  policies: RuntimePolicy[];
  rulings: RuntimeRuling[];
};

/** FNV-1a over a string: a short, stable fingerprint (not a security hash). */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function runtimeBook(r: CradleResponse, site: { id: string; name: string }, at = new Date().toISOString()): RuntimeBook {
  const policies: RuntimePolicy[] = r.book
    .filter((p) => p.status !== "retired")
    .map((p) => ({
      key: p.key, title: p.title, statement: p.statement, concept: p.concept, event: p.event, criticality: p.criticality,
      parameters: p.parameters, kernel: p.kernel, status: p.status as RuntimePolicy["status"], version: p.version,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  // One ruling often settles several contradictions: the app sees it once, with every policy it touched.
  const byText = new Map<string, RuntimeRuling>();
  for (const c of r.conflicts.filter((x) => x.status === "resolved" && x.ruling?.trim()).sort((a, b) => a.id.localeCompare(b.id))) {
    const text = c.ruling!.trim();
    const cur = byText.get(text);
    if (cur) cur.keys = [...new Set([...cur.keys, ...c.keys])].sort();
    else byText.set(text, { id: c.id, keys: [...c.keys].sort(), ruling: text });
  }
  const rulings = [...byText.values()];
  const pack = r.pack ? { id: r.pack.id, version: r.pack.version } : null;
  return { site, pack, version: fingerprint(JSON.stringify({ pack, policies, rulings })), at, policies, rulings };
}

/** The mark a transformed app shows (the store's header, its home page): one line, the same on every Cradle site. */
export const CRADLE_MARK = { title: "Running on AI", tagline: "Intelligence matters", by: "Accelerator Cradle" } as const;

/**
 * What /api/runtime/book returns: the live book (newest rules), the version in
 * force (the last one that passed the conformance gate; null before the first
 * proof), the scenarios that prove it, the newest proof of the live version,
 * and the mark.
 */
export type RuntimeResponse = RuntimeBook & {
  mark: typeof CRADLE_MARK;
  scenarios: import("./cradle-proof").Scenario[];
  inForce: { version: string; at: string; book: RuntimeBook } | null;
  proof: import("./cradle-proof").Proof | null;
};
