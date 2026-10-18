import { describe, expect, it } from "vitest";

import { artifactCards, progressFor, summarize } from "./cockpit";
import { DEFAULT_MODELS, resolveModels, type WorkActions, type WorkDetail, type WorkItem } from "./flywheel";

const at = "2026-10-18T12:00:00Z";
const noActions = {
  ask: true, begin: false, draftDesign: false, approveDesign: false, draftPlan: false, approvePlan: false, runNextStep: false,
  nextStep: null, prove: false, approveTry: false, release: false, ship: false, close: false, cancel: true,
} satisfies WorkActions;

function detail(w: Partial<WorkItem> = {}, d: Partial<WorkDetail> = {}): WorkDetail {
  const work: WorkItem = {
    id: "w1", number: 7, kind: "change", title: "Fix the Returns link", stage: "discuss", risk: [], complexity: "medium",
    recommendedComplexity: null, complexityReason: null, complexitySetBy: "platform", ready: false, autoShip: false, paused: false, proofRepairs: 0,
    branch: null, planApproved: false, previewUrl: null, proof: null, tryApproved: false, released: false, release: null, createdAt: at, updatedAt: at, ...w,
  };
  return { work, messages: [], designs: [], steps: [], jobs: [], events: [], actions: noActions, crewNext: null, decision: null, models: resolveModels(DEFAULT_MODELS), runnerOnline: true, ...d };
}
const doc = (version: number, approved: boolean, body = "# Title\n\n## Summary\nMake the **Returns** link work on every page.\n\n## What changes\n- footer") => ({
  id: `d${version}`, version, body, authorLabel: "Designer", model: null, approvedAt: approved ? at : null, createdAt: at,
});
const step = (position: number, status: "todo" | "running" | "done" | "blocked", extra = {}) => ({
  id: `s${position}`, position, title: `Step ${position}`, detail: "", status, attempts: status === "blocked" ? 3 : 1, evidence: {}, ...extra,
});
const ids = (m: ReturnType<typeof progressFor>) => m.map((x) => `${x.id}:${x.state}`);

describe("progressFor: where we are, sized to the tier", () => {
  it("Low skips the Brief and approvals entirely", () => {
    const m = progressFor(detail({ complexity: "low", ready: true, planApproved: true }, { steps: [step(1, "running")], jobs: [{ id: "j", kind: "build_step", status: "running", provider: "anthropic", model: "m", error: null, createdAt: at, startedAt: at, finishedAt: null }] }));
    expect(ids(m)).toEqual(["understood:done", "built:current", "proven:todo", "shipped:todo", "live:todo"]);
    expect(m[1]!.note).toBe("0 of 1 step");
    expect(m[3]!.label).toBe("Shipped");
  });
  it("Medium waits on you for the Brief, then for Ship it", () => {
    const brief = progressFor(detail({ ready: true }, { designs: [doc(1, false)], decision: { kind: "approve_brief", key: "approve_brief:v1", title: "Approve the Brief (v1)", action: "Approve the Brief", ownerOnly: false, needsRelease: false } }));
    expect(ids(brief).slice(0, 2)).toEqual(["understood:done", "brief:waiting"]);
    const ship = progressFor(
      detail(
        { ready: true, planApproved: true, proof: { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 9, failed: 0, total: 9 }, baseline: null, pushed: true, previewState: "success", branch: "b", commit: "abc", previewUrl: "u", previewStatus: 200, at } },
        { designs: [doc(1, true)], steps: [step(1, "done")], decision: { kind: "ship", key: "ship:abc", title: "Ship it (abc)", action: "Ship it", ownerOnly: false, needsRelease: true } },
      ),
    );
    expect(ids(ship)).toEqual(["understood:done", "brief:done", "built:done", "proven:done", "shipped:waiting", "live:todo"]);
    expect(ship[3]!.note).toBe("9/9 tests green, preview up");
  });
  it("High shows design and plan approvals, and a blocked step plainly", () => {
    const m = progressFor(detail({ complexity: "high", ready: true, planApproved: true }, { designs: [doc(2, true)], steps: [step(1, "done"), step(2, "blocked", { evidence: { reasons: ["1 test failing."] } })] }));
    expect(ids(m)).toEqual(["understood:done", "design:done", "plan:done", "built:blocked", "proven:todo", "shipped:todo", "live:todo"]);
    expect(m[3]!.note).toBe("Step 2 didn't pass its checks (3 runs)");
  });
  it("marks everything done once live", () => {
    const m = progressFor(
      detail(
        { complexity: "low", ready: true, planApproved: true, tryApproved: true, released: true, proof: { ok: true, reasons: [], typecheck: true, build: true, tests: null, baseline: null, pushed: true, previewState: "success", branch: "b", commit: "c", previewUrl: null, previewStatus: null, at }, release: { ok: true, reasons: [], stageCommit: "s", mainCommit: "m", productionState: "success", liveUrl: "https://shop.example", liveStatus: 200, at } },
        { steps: [step(1, "done")] },
      ),
    );
    expect(m.every((x) => x.state === "done")).toBe(true);
    expect(m.at(-1)!.note).toBe("https://shop.example answers 200");
  });
  it("says when the crew is paused", () => {
    const m = progressFor(detail({ complexity: "low", ready: true, planApproved: true, paused: true }, { steps: [step(1, "todo")] }));
    expect(m[1]).toMatchObject({ id: "built", state: "todo", note: "0 of 1 step · paused" });
  });
});

describe("summarize", () => {
  it("takes the Summary or Goal section in plain words", () => {
    expect(summarize(doc(1, true).body)).toBe("Make the Returns link work on every page.");
    expect(summarize("# T\n\n## Goal (two sentences)\nShow [prices](x) clearly.\n\n## Scope")).toBe("Show prices clearly.");
  });
  it("falls back to the first paragraph and shortens long text", () => {
    expect(summarize("# Title\n\nFirst paragraph here.\n\nSecond.")).toBe("First paragraph here.");
    expect(summarize(`## Summary\n${"word ".repeat(80)}`, 40)).toHaveLength(40);
  });
});

describe("artifactCards", () => {
  it("shows the Brief's summary and status, the plan's next step, proof and the log", () => {
    const cards = artifactCards(detail({ planApproved: true }, { designs: [doc(2, true)], steps: [step(1, "done"), step(2, "todo")] }));
    expect(cards.map((c) => c.id)).toEqual(["design", "plan", "ship", "log"]);
    expect(cards[0]).toMatchObject({ title: "Brief v2", status: "Approved", tone: "good", lines: ["Make the Returns link work on every page."] });
    expect(cards[1]).toMatchObject({ title: "Plan · 1/2", status: "The crew's plan", lines: ["Next: step 2, Step 2"] });
    expect(cards[2]).toMatchObject({ status: "Not proven", lines: ["Prove runs once every step is built"] });
    expect(cards[3]).toMatchObject({ status: "No runs yet" });
  });
  it("leaves out the design card for Low items with no design", () => {
    expect(artifactCards(detail({ complexity: "low" })).map((c) => c.id)).toEqual(["plan", "ship", "log"]);
  });
  it("puts a blocked step's reason first", () => {
    const plan = artifactCards(detail({ complexity: "high", planApproved: true }, { steps: [step(1, "blocked", { evidence: { reasons: ["Typecheck failed."] } })] }))[1]!;
    expect(plan).toMatchObject({ tone: "warn", status: "Approved", lines: ["Step 1: Step 1", "Typecheck failed."] });
  });
});
