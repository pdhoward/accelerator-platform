import { describe, expect, it } from "vitest";

import { casePassed, proofOutcome, runsFor, type Scenario } from "./cradle-proof";

const scenario = (id: string, over: Partial<Scenario> = {}): Scenario => ({
  id, title: id, policies: ["C-INV-1"], criticality: "critical", given: "", when: "", then: "", status: "approved", source: "ruling",
  check: { kind: "search", request: "drill", expect: { noOutOfStock: true, maxPrice: null, minResults: 1 } },
  ...over,
});

describe("the conformance gate", () => {
  it("samples agent scenarios: critical ones three times, deterministic ones once", () => {
    expect(runsFor(scenario("a"))).toBe(3);
    expect(runsFor(scenario("b", { criticality: "routine" }))).toBe(1);
    expect(runsFor(scenario("c", { check: { kind: "buy", product: { price: 1, currency: "USD", stock: "in" }, expect: true } }))).toBe(1);
  });
  it("passes a case only when every run passed", () => {
    expect(casePassed(3, 3)).toBe(true);
    expect(casePassed(3, 2)).toBe(false);
    expect(casePassed(0, 0)).toBe(false);
  });
  it("promotes only when every live scenario, drafts included, passed", () => {
    const s = [scenario("a"), scenario("b", { status: "draft" }), scenario("c", { status: "retired" })];
    const ok = (id: string) => ({ id, passed: true, runs: 1, passes: 1, detail: "", ms: 1 });
    expect(proofOutcome(s, [ok("a"), ok("b")])).toEqual({ status: "passed", passed: 2, total: 2 });
    expect(proofOutcome(s, [ok("a"), { ...ok("b"), passed: false }])).toEqual({ status: "failed", passed: 1, total: 2 });
    expect(proofOutcome(s, [ok("a")]).status).toBe("failed");
  });
  it("never passes an empty suite", () => {
    expect(proofOutcome([], []).status).toBe("failed");
  });
});
