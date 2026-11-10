/**
 * The proof scorecard (gen3-cradle.md backlog B7): the conformance gate's
 * evidence, summed up for the site owner. Each proof is one run of the suite
 * against one version of the book; the scorecard reads them all and answers
 * "how well proven are my rules, which tests are unreliable, what is not
 * tested at all, and what has it cost?". Pure: the API gathers, this decides.
 */

import type { CaseResult, Proof, Scenario } from "./cradle-proof";
import type { RuntimeBook } from "./cradle-runtime";

/** A finished proof run (passed or failed), as kept in the graph. */
export type ProofRun = Pick<Proof, "bookVersion" | "at" | "status" | "results" | "passed" | "total" | "costUsd">;

export type CaseVerdict = "passing" | "failing" | "flaky" | "not run";

/** One scenario's record across runs, newest first. */
export type CaseScore = {
  id: string;
  title: string;
  criticality: Scenario["criticality"];
  status: Scenario["status"];
  policies: string[];
  concepts: string[];
  verdict: CaseVerdict;
  latest: CaseResult | null;
  /** Up to the last 10 runs that included this scenario, newest first. */
  history: { version: string; at: string; runs: number; passes: number }[];
  /** What the steward could do about it, in plain words; null when nothing is needed. */
  advice: string | null;
};

export type Tally = { passed: number; total: number };

export type ProofScorecard = {
  live: string | null;
  inForce: string | null;
  latest: { version: string; at: string; status: "passed" | "failed"; passed: number; total: number; costUsd: number } | null;
  byCriticality: ({ criticality: Scenario["criticality"] } & Tally)[];
  byConcept: ({ concept: string } & Tally)[];
  cases: CaseScore[];
  coverage: {
    policies: number;
    covered: number;
    rulings: number;
    coveredRulings: number;
    uncovered: { key: string; title: string; concept: string; criticality: string }[];
    uncoveredRulings: { id: string; keys: string[]; ruling: string }[];
  };
  /** Every finished run, newest first. */
  history: { version: string; at: string; status: "passed" | "failed"; passed: number; total: number; costUsd: number; inForce: boolean }[];
  /** Book versions that were proven and never passed: rule changes the gate stopped. */
  heldVersions: number;
  totalCostUsd: number;
  runs: number;
};

const CRITICALITIES: Scenario["criticality"][] = ["critical", "important", "routine"];
const WINDOW = 5;

/**
 * A scenario is flaky when, in its last few runs, it passed only some of the
 * samples in one run, or flipped between pass and fail more than once. Either
 * is usually a sign the rule (or the test) can be read two ways.
 */
export function isFlaky(history: { runs: number; passes: number }[]): boolean {
  const recent = history.slice(0, WINDOW);
  if (recent.some((h) => h.passes > 0 && h.passes < h.runs)) return true;
  let flips = 0;
  for (let i = 1; i < recent.length; i++) if ((recent[i]!.passes === recent[i]!.runs) !== (recent[i - 1]!.passes === recent[i - 1]!.runs)) flips++;
  return flips >= 2;
}

export function proofScorecard(input: {
  scenarios: Scenario[];
  runs: ProofRun[];
  book: Pick<RuntimeBook, "version" | "policies" | "rulings"> | null;
  inForce: string | null;
  openConflicts?: { id: string; keys: string[]; why: string }[];
}): ProofScorecard {
  const runs = input.runs.filter((r) => r.status === "passed" || r.status === "failed").sort((a, b) => b.at.localeCompare(a.at));
  const live = input.scenarios.filter((s) => s.status !== "retired");
  const policies = input.book?.policies ?? [];
  const conceptOf = new Map(policies.map((p) => [p.key, p.concept]));
  const titleOf = new Map(policies.map((p) => [p.key, p.title]));
  const latestRun = runs.find((r) => r.bookVersion === input.book?.version) ?? runs[0] ?? null;
  const latestById = new Map((latestRun?.results ?? []).map((r) => [r.id, r]));

  const cases: CaseScore[] = live.map((s) => {
    const history = runs
      .map((r) => ({ run: r, res: r.results.find((x) => x.id === s.id) }))
      .filter((x): x is { run: ProofRun; res: CaseResult } => !!x.res)
      .slice(0, 10)
      .map(({ run, res }) => ({ version: run.bookVersion, at: run.at, runs: res.runs, passes: res.passes }));
    const latest = latestById.get(s.id) ?? null;
    const flaky = isFlaky(history);
    const verdict: CaseVerdict = !latest ? "not run" : flaky ? "flaky" : latest.passed ? "passing" : "failing";
    return {
      id: s.id, title: s.title, criticality: s.criticality, status: s.status, policies: s.policies,
      concepts: [...new Set(s.policies.map((k) => conceptOf.get(k)).filter((c): c is string => !!c))],
      verdict, latest, history,
      advice: adviceFor(s, verdict, history, input.openConflicts ?? [], titleOf),
    };
  });

  const tally = (list: CaseScore[]): Tally => ({ passed: list.filter((c) => c.latest?.passed).length, total: list.length });
  const byCriticality = CRITICALITIES.map((criticality) => ({ criticality, ...tally(cases.filter((c) => c.criticality === criticality)) })).filter((t) => t.total > 0);
  const concepts = [...new Set(cases.flatMap((c) => (c.concepts.length ? c.concepts : ["(no concept)"])))].sort();
  const byConcept = concepts.map((concept) => ({ concept, ...tally(cases.filter((c) => (c.concepts.length ? c.concepts.includes(concept) : concept === "(no concept)"))) }));

  const covered = new Set(live.flatMap((s) => s.policies));
  // Most critical first: the order an owner should review and test them in.
  const rank = (c: string) => { const i = (CRITICALITIES as string[]).indexOf(c); return i < 0 ? CRITICALITIES.length : i; };
  const uncovered = policies
    .filter((p) => !covered.has(p.key))
    .map((p) => ({ key: p.key, title: p.title, concept: p.concept, criticality: p.criticality }))
    .sort((a, b) => rank(a.criticality) - rank(b.criticality));
  const rulings = input.book?.rulings ?? [];
  const uncoveredRulings = rulings.filter((r) => !r.keys.some((k) => covered.has(k)));

  const passedVersions = new Set(runs.filter((r) => r.status === "passed").map((r) => r.bookVersion));
  const heldVersions = new Set(runs.filter((r) => !passedVersions.has(r.bookVersion)).map((r) => r.bookVersion)).size;

  return {
    live: input.book?.version ?? null,
    inForce: input.inForce,
    latest: latestRun ? { version: latestRun.bookVersion, at: latestRun.at, status: latestRun.status as "passed" | "failed", passed: latestRun.passed, total: latestRun.total, costUsd: latestRun.costUsd } : null,
    byCriticality,
    byConcept,
    cases,
    coverage: { policies: policies.length, covered: policies.length - uncovered.length, rulings: rulings.length, coveredRulings: rulings.length - uncoveredRulings.length, uncovered, uncoveredRulings },
    history: runs.map((r) => ({ version: r.bookVersion, at: r.at, status: r.status as "passed" | "failed", passed: r.passed, total: r.total, costUsd: r.costUsd, inForce: r.bookVersion === input.inForce && r.status === "passed" })),
    heldVersions,
    totalCostUsd: Math.round(runs.reduce((s, r) => s + (r.costUsd || 0), 0) * 10000) / 10000,
    runs: runs.length,
  };
}

function adviceFor(
  s: Scenario,
  verdict: CaseVerdict,
  history: { version: string; runs: number; passes: number }[],
  conflicts: { id: string; keys: string[]; why: string }[],
  titleOf: Map<string, string>,
): string | null {
  const conflict = conflicts.find((c) => c.keys.some((k) => s.policies.includes(k)));
  if (conflict && verdict !== "passing") return `Contradicts: ${conflict.why} Settle it in the Policy Walk first; the test can't pass while the rules disagree.`;
  const rule = s.policies.map((k) => titleOf.get(k) ?? k).join(", ");
  if (verdict === "flaky") return `Restate: the wording of ${rule || "this rule"} may allow two readings. Rewrite it as one plain sentence, or make the test's "then" stricter.`;
  if (verdict !== "failing") return null;
  const lastPass = history.find((h) => h.runs > 0 && h.passes === h.runs);
  if (lastPass) return `Regression: it passed on version ${lastPass.version}. Look at what changed in ${rule || "the rules"} since then.`;
  if (s.status === "draft") return "Never passed, and the crew wrote it: check the test first. If the test is wrong, retire it; if the app is wrong, fix the rule or the app.";
  return `Never passed: check that the app follows ${rule || "this rule"}, then that the test reads it correctly.`;
}
