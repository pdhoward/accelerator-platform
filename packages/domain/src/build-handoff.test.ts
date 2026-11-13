import { describe, expect, it } from "vitest";

import { buildPrompt, handoff, planSystem } from "./prompts";
import type { JobContext, WorkStep } from "./flywheel";

const step = (position: number, status: WorkStep["status"], evidence: WorkStep["evidence"] = {}): WorkStep =>
  ({ id: `s${position}`, position, title: `Step ${position}`, detail: "", status, attempts: 1, evidence }) as WorkStep;

const work = {
  number: 1, title: "Upgrade", complexity: "high", design: { body: "The design." }, messages: [],
  steps: [step(1, "done", { summary: "Added the tests.", commit: "abcdef1234", files: ["a", "b"] }), step(2, "done", { summary: "Removed old code." }), step(3, "todo"), step(4, "todo")],
} as unknown as NonNullable<JobContext["work"]>;

describe("a fresh builder session per step (B33)", () => {
  it("hands the next builder what the earlier steps did", () => {
    const h = handoff(work, work.steps[2]!, "stage");
    expect(h).toMatch(/WHAT THE EARLIER STEPS DID/);
    expect(h).toMatch(/1\. Step 1 \(commit abcdef12, 2 files\)\n {3}Added the tests\./);
    expect(h).toMatch(/Removed old code/);
    expect(h).toMatch(/git diff stage\.\.\.HEAD/);
    expect(buildPrompt(work, work.steps[2]!, [], "stage")).toContain("WHAT THE EARLIER STEPS DID");
  });

  it("has nothing to hand over on the first step", () => {
    expect(handoff(work, work.steps[0]!)).toBe("");
  });

  it("tells the planner each step costs a full proof run", () => {
    const ctx = { job: { kind: "plan" }, site: { name: "Blog", url: "https://b", stack: null, domain: null }, work: null } as unknown as JobContext;
    expect(planSystem(ctx)).toMatch(/Merge mechanical changes/);
  });
});
