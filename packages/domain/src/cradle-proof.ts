/**
 * The conformance gate (gen3-cradle.md §4, backlog B5): test-driven policy
 * for an AI-run app. Every policy and ruling is proven by scenarios. When the
 * book changes, the app proves the new version against every scenario before
 * it serves it; until the proof passes, the version that last passed stays in
 * force. Pure: the API stores, the app runs, these decide.
 */

export type ScenarioKind = "buy" | "search" | "assistant" | "notice";
export type NoticeField = "productPage" | "footer" | "orderTestMode" | "orderLiveMode";

/** What a scenario checks, in a form a machine can judge. */
export type ScenarioCheck =
  | { kind: "buy"; product: { price: number | null; currency: string; stock: "in" | "out" | "unknown" }; expect: boolean }
  | { kind: "search"; request: string; expect: { noOutOfStock: boolean; maxPrice: number | null; minResults: number } }
  | { kind: "assistant"; message: string; expect: { mustCall: string[]; mustNotCall: string[]; replyMust: string } }
  | { kind: "notice"; field: NoticeField; must: string };

export type Scenario = {
  id: string;
  title: string;
  policies: string[];
  criticality: "critical" | "important" | "routine";
  given: string;
  when: string;
  then: string;
  check: ScenarioCheck;
  /** draft: written by the crew, running, waiting for the steward; approved: the steward's own test. */
  status: "draft" | "approved" | "retired";
  source: "example" | "ruling" | "crew";
};

export type CaseResult = { id: string; passed: boolean; runs: number; passes: number; detail: string; ms: number };

export type Proof = {
  bookVersion: string;
  at: string;
  status: "running" | "passed" | "failed";
  results: CaseResult[];
  passed: number;
  total: number;
  costUsd: number;
};

/** An agent is sampled, not proven (§4.3): critical scenarios run three times and must pass every time. */
export const runsFor = (s: Pick<Scenario, "criticality" | "check">) => (s.check.kind === "buy" || s.check.kind === "notice" ? 1 : s.criticality === "critical" ? 3 : 1);

/** A case passes only when every run passed. */
export const casePassed = (runs: number, passes: number) => runs > 0 && passes === runs;

/** The gate: every scenario in force (drafts included) must pass. */
export function proofOutcome(scenarios: Scenario[], results: CaseResult[]): { status: "passed" | "failed"; passed: number; total: number } {
  const live = scenarios.filter((s) => s.status !== "retired");
  const byId = new Map(results.map((r) => [r.id, r]));
  const passed = live.filter((s) => byId.get(s.id)?.passed).length;
  return { status: live.length > 0 && passed === live.length ? "passed" : "failed", passed, total: live.length };
}

/** The tag the steward sees on a scenario card: "3/3", "held", "not run". */
export const caseLabel = (r: CaseResult | undefined) => (!r ? "not run" : `${r.passes}/${r.runs}`);
