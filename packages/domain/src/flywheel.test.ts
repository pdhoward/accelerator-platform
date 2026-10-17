import { describe, expect, it } from "vitest";

import {
  agreementText,
  DEFAULT_MODELS,
  protocolVerdict,
  proveVerdict,
  releaseVerdict,
  resolveModels,
  stageFor,
  validateModels,
  autoAction,
  workActions,
  type ProveFacts,
  type WorkFacts,
} from "./flywheel";

/** High complexity unless a test says otherwise: the full gates. */
const facts = (f: Partial<WorkFacts>): WorkFacts => ({
  stage: "discuss",
  risk: [],
  complexity: "high",
  ready: false,
  autoShip: false,
  paused: false,
  proofRepairs: 0,
  jobRunning: false,
  latestDesign: null,
  planApproved: false,
  steps: [],
  proven: false,
  proofFailed: false,
  tryApproved: false,
  released: false,
  ...f,
});

/** Every step built and checked: ready for Prove. */
const built = facts({ stage: "prove", latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "done" }, { status: "done" }] });
const { stage: _s, jobRunning: _j, ...builtShape } = built;

describe("workActions: the three gates", () => {
  it("can't plan before the design is approved", () => {
    const a = workActions(facts({ latestDesign: { version: 1, approved: false } }));
    expect(a.approveDesign).toBe(true);
    expect(a.draftPlan).toBe(false);
  });
  it("can't build before the plan is approved", () => {
    const f = facts({ latestDesign: { version: 2, approved: true }, steps: [{ status: "todo" }] });
    expect(workActions(f)).toMatchObject({ approvePlan: true, runNextStep: false });
    expect(autoAction(f)).toBeNull(); // High: the plan is the client's decision
    // Approved: the crew builds the steps itself; the button is only for a blocked step.
    expect(workActions({ ...f, planApproved: true })).toMatchObject({ runNextStep: false, nextStep: 0 });
    expect(autoAction({ ...f, planApproved: true })).toBe("build_step");
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
  const none = { proven: false, proofFailed: false, tryApproved: false, released: false, complexity: "high" as const, ready: false, autoShip: false, paused: false, proofRepairs: 0 };
  it("walks discuss → design → plan → build → prove", () => {
    expect(stageFor({ ...none, risk: [], latestDesign: null, planApproved: false, steps: [] })).toBe("discuss");
    expect(stageFor({ ...none, risk: [], latestDesign: { version: 1, approved: false }, planApproved: false, steps: [] })).toBe("design");
    expect(stageFor({ ...none, risk: [], latestDesign: { version: 1, approved: true }, planApproved: false, steps: [] })).toBe("plan");
    expect(stageFor({ ...none, risk: [], latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "todo" }] })).toBe("build");
    expect(stageFor({ ...none, risk: [], latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "done" }, { status: "skipped" }] })).toBe("prove");
  });
  it("walks prove → try → release → learn", () => {
    expect(stageFor({ ...builtShape, proven: true })).toBe("try");
    expect(stageFor({ ...builtShape, proven: true, tryApproved: true })).toBe("release");
    expect(stageFor({ ...builtShape, proven: true, tryApproved: true, released: true })).toBe("learn");
  });
  it("drops back to build when new steps are added after Prove", () => {
    expect(stageFor({ ...builtShape, proven: true, steps: [{ status: "done" }, { status: "todo" }] })).toBe("build");
  });
});

describe("workActions: prove, try, release, close", () => {
  it("proves on its own once every step is built, and offers Prove again only after a failed Prove", () => {
    expect(workActions(built)).toMatchObject({ prove: false, approveTry: false, release: false });
    expect(autoAction(built)).toBe("prove");
    expect(workActions({ ...built, proofFailed: true }).prove).toBe(true);
    // A failed Prove gets one automatic fix round, then waits for a person.
    expect(autoAction({ ...built, proofFailed: true })).toBe("repair_proof");
    expect(autoAction({ ...built, proofFailed: true, proofRepairs: 1 })).toBeNull();
    expect(workActions(facts({ ...built, steps: [{ status: "done" }, { status: "todo" }] })).prove).toBe(false);
  });
  it("needs a passed Prove before Try, and an approved Try before Release (gate 3)", () => {
    expect(workActions({ ...built, stage: "try", proven: true })).toMatchObject({ approveTry: true, release: false });
    expect(workActions({ ...built, stage: "release", proven: true, tryApproved: true })).toMatchObject({ approveTry: false, release: true, prove: false });
  });
  it("closes only after release, and stops design and plan changes once live", () => {
    const live = { ...built, stage: "learn" as const, proven: true, tryApproved: true, released: true };
    expect(workActions(live)).toMatchObject({ close: true, release: false, draftDesign: false, draftPlan: false });
  });
  it("does nothing while a job runs", () => {
    expect(workActions({ ...built, proofFailed: true, jobRunning: true }).prove).toBe(false);
    expect(autoAction({ ...built, jobRunning: true })).toBeNull();
  });
  it("can cancel at any stop before release, never after, and not while a job runs", () => {
    expect(workActions(facts({})).cancel).toBe(true); // still discussing
    expect(workActions({ ...built, stage: "try", proven: true }).cancel).toBe(true);
    expect(workActions({ ...built, stage: "learn", proven: true, tryApproved: true, released: true }).cancel).toBe(false);
    expect(workActions(facts({ jobRunning: true })).cancel).toBe(false);
    expect(workActions(facts({ stage: "cancelled" })).cancel).toBe(false);
  });
});

describe("proveVerdict and releaseVerdict", () => {
  const green: ProveFacts = { typecheck: true, build: true, tests: { passed: 4, failed: 0, total: 4 }, baseline: 3, pushed: true, previewState: "success" };
  it("passes when every check is green and the preview deployed", () => {
    expect(proveVerdict(green)).toEqual({ ok: true, reasons: [] });
    expect(proveVerdict({ ...green, build: null }).ok).toBe(true); // no build script
  });
  it("names every reason it fails", () => {
    expect(proveVerdict({ ...green, build: false }).reasons).toContain("The production build failed.");
    expect(proveVerdict({ ...green, tests: { passed: 2, failed: 0, total: 2 } }).reasons[0]).toMatch(/below the site's baseline/);
    expect(proveVerdict({ ...green, pushed: false }).reasons).toContain("The branch couldn't be pushed to GitHub.");
    expect(proveVerdict({ ...green, previewState: "missing" }).reasons[0]).toMatch(/No preview deployment/);
    expect(proveVerdict({ ...green, previewState: "failure" }).reasons[0]).toMatch(/"failure"/);
  });
  it("reports only the failed checks when the push was skipped", () => {
    expect(proveVerdict({ ...green, typecheck: false, pushed: false, previewState: "skipped" }).reasons).toEqual(["Typecheck failed."]);
    expect(proveVerdict({ ...green, pushed: false, previewState: "skipped" }).ok).toBe(false);
  });
  it("passes a release only when main moved, production deployed and the site answers", () => {
    expect(releaseVerdict({ mainCommit: "abc", productionState: "success", liveStatus: 200 }).ok).toBe(true);
    expect(releaseVerdict({ mainCommit: null, productionState: "success", liveStatus: 200 }).ok).toBe(false);
    expect(releaseVerdict({ mainCommit: "abc", productionState: "missing", liveStatus: 200 }).ok).toBe(false);
    expect(releaseVerdict({ mainCommit: "abc", productionState: "success", liveStatus: 500 }).reasons).toContain("The live site answered 500.");
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
