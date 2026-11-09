import { describe, expect, it } from "vitest";

import type { CaseResult, Scenario } from "./cradle-proof";
import type { RuntimePolicy } from "./cradle-runtime";
import { isFlaky, proofScorecard, type ProofRun } from "./cradle-scorecard";

const scenario = (id: string, over: Partial<Scenario> = {}): Scenario => ({
  id, title: id, policies: ["C-INV-1"], criticality: "critical", given: "", when: "", then: "", status: "approved", source: "ruling",
  check: { kind: "search", request: "drill", expect: { noOutOfStock: true, maxPrice: null, minResults: 1 } },
  ...over,
});
const policy = (key: string, concept: string): RuntimePolicy => ({ key, title: `Rule ${key}`, statement: "", concept, event: "e", criticality: "critical", parameters: {}, kernel: null, status: "confirmed", version: 1 });
const res = (id: string, passes: number, runs = 3): CaseResult => ({ id, passed: passes === runs, runs, passes, detail: "", ms: 1 });
const run = (version: string, at: string, results: CaseResult[], costUsd = 0.2): ProofRun => {
  const passed = results.filter((r) => r.passed).length;
  return { bookVersion: version, at, status: passed === results.length ? "passed" : "failed", results, passed, total: results.length, costUsd };
};
const book = { version: "v3", policies: [policy("C-INV-1", "inventory"), policy("C-PAY-1", "payment"), policy("C-SHIP-1", "shipping")], rulings: [{ id: "K-1", keys: ["C-PAY-1"], ruling: "Pay by card only." }] };

describe("the proof scorecard", () => {
  it("calls a scenario flaky when one run passes only some samples", () => {
    expect(isFlaky([{ runs: 3, passes: 2 }])).toBe(true);
    expect(isFlaky([{ runs: 3, passes: 3 }, { runs: 3, passes: 0 }])).toBe(false); // fixed once: not flaky
    expect(isFlaky([{ runs: 1, passes: 0 }, { runs: 1, passes: 1 }, { runs: 1, passes: 0 }])).toBe(true); // flipped twice
  });

  it("scores the newest proof by criticality and by concept", () => {
    const s = [scenario("SCN-1"), scenario("SCN-2", { policies: ["C-PAY-1"], criticality: "routine" })];
    const card = proofScorecard({ scenarios: s, runs: [run("v3", "2026-11-09T10:00:00Z", [res("SCN-1", 3), res("SCN-2", 0, 1)])], book, inForce: "v2" });
    expect(card.latest).toMatchObject({ version: "v3", status: "failed", passed: 1, total: 2 });
    expect(card.byCriticality).toEqual([{ criticality: "critical", passed: 1, total: 1 }, { criticality: "routine", passed: 0, total: 1 }]);
    expect(card.byConcept).toEqual([{ concept: "inventory", passed: 1, total: 1 }, { concept: "payment", passed: 0, total: 1 }]);
  });

  it("lists the policies and rulings no scenario tests", () => {
    const card = proofScorecard({ scenarios: [scenario("SCN-1"), scenario("SCN-9", { policies: ["C-PAY-1"], status: "retired" })], runs: [], book, inForce: null });
    expect(card.coverage).toMatchObject({ policies: 3, covered: 1, rulings: 1, coveredRulings: 0 });
    expect(card.coverage.uncovered.map((u) => u.key)).toEqual(["C-PAY-1", "C-SHIP-1"]);
    expect(card.cases.map((c) => c.verdict)).toEqual(["not run"]);
  });

  it("explains each problem case: flaky, regression, a crew draft that never passed, a contradiction", () => {
    const s = [scenario("SCN-1"), scenario("SCN-2"), scenario("SCN-3", { status: "draft" }), scenario("SCN-4", { policies: ["C-SHIP-1"] })];
    const runs = [
      run("v2", "2026-11-08T10:00:00Z", [res("SCN-1", 3), res("SCN-2", 3), res("SCN-3", 0), res("SCN-4", 3)]),
      run("v3", "2026-11-09T10:00:00Z", [res("SCN-1", 2), res("SCN-2", 0), res("SCN-3", 0), res("SCN-4", 0)]),
    ];
    const card = proofScorecard({ scenarios: s, runs, book, inForce: "v2", openConflicts: [{ id: "X-1", keys: ["C-SHIP-1"], why: "Two shipping rates." }] });
    const byId = Object.fromEntries(card.cases.map((c) => [c.id, c]));
    expect(byId["SCN-1"]!.verdict).toBe("flaky");
    expect(byId["SCN-1"]!.advice).toMatch(/^Restate: the wording of Rule C-INV-1/);
    expect(byId["SCN-2"]!.advice).toMatch(/^Regression: it passed on version v2/);
    expect(byId["SCN-3"]!.advice).toMatch(/check the test first/);
    expect(byId["SCN-4"]!.advice).toMatch(/^Contradicts: Two shipping rates\./);
    expect(byId["SCN-2"]!.history.map((h) => h.version)).toEqual(["v3", "v2"]);
  });

  it("counts held versions, the version in force and the cost to date", () => {
    const runs = [
      run("v1", "2026-11-07T10:00:00Z", [res("SCN-1", 3)], 0.18),
      run("v2", "2026-11-08T10:00:00Z", [res("SCN-1", 0)], 0.21),
      run("v3", "2026-11-09T09:00:00Z", [res("SCN-1", 1)], 0.2),
      run("v3", "2026-11-09T10:00:00Z", [res("SCN-1", 3)], 0.19),
    ];
    const card = proofScorecard({ scenarios: [scenario("SCN-1")], runs, book, inForce: "v3" });
    expect(card.heldVersions).toBe(1); // v2 never passed; v3 failed once, then passed
    expect(card.totalCostUsd).toBe(0.78);
    expect(card.runs).toBe(4);
    expect(card.history[0]).toMatchObject({ version: "v3", status: "passed", inForce: true });
    expect(card.history[1]).toMatchObject({ version: "v3", status: "failed", inForce: false });
  });
});
