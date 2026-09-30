import { describe, expect, it } from "vitest";

import { agreementText, DEFAULT_MODELS, protocolVerdict, resolveModels, stageFor, validateModels, workActions, type WorkFacts } from "./flywheel";

const facts = (f: Partial<WorkFacts>): WorkFacts => ({
  stage: "discuss",
  risk: [],
  jobRunning: false,
  latestDesign: null,
  planApproved: false,
  steps: [],
  ...f,
});

describe("workActions: the three gates", () => {
  it("can't plan before the design is approved", () => {
    const a = workActions(facts({ latestDesign: { version: 1, approved: false } }));
    expect(a.approveDesign).toBe(true);
    expect(a.draftPlan).toBe(false);
  });
  it("can't build before the plan is approved", () => {
    const f = facts({ latestDesign: { version: 2, approved: true }, steps: [{ status: "todo" }] });
    expect(workActions(f)).toMatchObject({ approvePlan: true, runNextStep: false });
    expect(workActions({ ...f, planApproved: true })).toMatchObject({ runNextStep: true, nextStep: 0 });
  });
  it("does nothing while a job runs, or once closed", () => {
    const f = facts({ latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "todo" }] });
    expect(workActions({ ...f, jobRunning: true }).runNextStep).toBe(false);
    expect(workActions({ ...f, stage: "done" }).ask).toBe(false);
  });
  it("retries a blocked step next", () => {
    const f = facts({ latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "done" }, { status: "blocked" }, { status: "todo" }] });
    expect(workActions(f).nextStep).toBe(1);
  });
});

describe("stageFor: the rail reflects what exists", () => {
  it("walks discuss → design → plan → build → prove", () => {
    expect(stageFor({ risk: [], latestDesign: null, planApproved: false, steps: [] })).toBe("discuss");
    expect(stageFor({ risk: [], latestDesign: { version: 1, approved: false }, planApproved: false, steps: [] })).toBe("design");
    expect(stageFor({ risk: [], latestDesign: { version: 1, approved: true }, planApproved: false, steps: [] })).toBe("plan");
    expect(stageFor({ risk: [], latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "todo" }] })).toBe("build");
    expect(stageFor({ risk: [], latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "done" }, { status: "skipped" }] })).toBe("prove");
  });
});

describe("protocolVerdict: a step is done only if every order holds", () => {
  const green = { typecheck: true, tests: { passed: 14, failed: 0, total: 14 }, testsBefore: 12, touchedTests: true, baseline: 9 };
  it("passes a clean step that added tests", () => {
    expect(protocolVerdict(green)).toEqual({ ok: true, reasons: [] });
  });
  it("fails on red checks, a shrinking suite, or no tests without a reason", () => {
    expect(protocolVerdict({ ...green, typecheck: false }).reasons).toContain("Typecheck failed.");
    expect(protocolVerdict({ ...green, tests: { passed: 13, failed: 1, total: 14 } }).reasons).toContain("1 test failing.");
    expect(protocolVerdict({ ...green, tests: { passed: 10, failed: 0, total: 10 } }).reasons).toContain("The suite shrank from 12 to 10 tests.");
    expect(protocolVerdict({ ...green, touchedTests: false }).ok).toBe(false);
    expect(protocolVerdict({ ...green, touchedTests: false, noTestsReason: "Copy change only; covered by existing snapshot." }).ok).toBe(true);
    expect(protocolVerdict({ ...green, tests: null }).reasons).toContain("The test suite didn't run.");
  });
});

describe("models (F15)", () => {
  it("defaults are valid and fill any unset role", () => {
    expect(validateModels(DEFAULT_MODELS)).toEqual([]);
    expect(resolveModels([{ role: "consult", provider: "openai", model: "gpt-5", keySource: "customer" }]).consult.model).toBe("gpt-5");
    expect(resolveModels([]).build.provider).toBe("anthropic");
  });
  it("rejects a builder without a harness, and a judge marking its own work", () => {
    const m = resolveModels([{ role: "build", provider: "openai", model: "gpt-5", keySource: "ours" }]);
    expect(validateModels(Object.values(m))[0]).toMatch(/agent harness/);
    const same = resolveModels([{ role: "judge", provider: "anthropic", model: "claude-opus-5-5", keySource: "ours" }]);
    expect(validateModels(Object.values(same))[0]).toMatch(/different model/);
  });
});

it("the Agreement lists what the engine can't see, plus site-specific items", () => {
  const text = agreementText("Machine Shop", ["The supplier's price list"]);
  expect(text).toContain("# Working agreement: Machine Shop");
  expect(text).toContain("- How the site feels to a real customer");
  expect(text).toContain("- The supplier's price list");
});
