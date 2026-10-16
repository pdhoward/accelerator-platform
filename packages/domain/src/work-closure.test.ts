import { describe, expect, it } from "vitest";
import { workClosureCopy } from "./work-closure";
import { workActions, type WorkFacts } from "./flywheel";
const built: WorkFacts = {
  stage: "try",
  risk: ["data"],
  jobRunning: false,
  latestDesign: { version: 1, approved: true },
  planApproved: true,
  steps: [{ status: "done" }],
  proven: true,
  tryApproved: false,
  released: false,
};
describe("ending a body of work independently of release", () => {
  it("allows closing built/proven work without forcing release or clearing evidence", () => {
    expect(workActions(built)).toMatchObject({
      cancel: true,
      close: false,
      release: false,
    });
    const copy = workClosureCopy({ number: 3, released: false });
    expect(copy.action).toBe("cancel");
    expect(copy.label).toBe("Close without platform release");
    expect(copy.receipt).not.toContain("without building");
    expect(copy.confirmation).toContain("does not deploy or undo code");
  });
  it("closes recorded released work through the existing completion action", () => {
    expect(
      workActions({ ...built, stage: "learn", released: true }),
    ).toMatchObject({ close: true, cancel: false });
    expect(workClosureCopy({ number: 3, released: true }).action).toBe("close");
  });
  it("does not close active jobs or reopen terminal items", () => {
    for (const f of [
      { ...built, jobRunning: true },
      { ...built, stage: "cancelled" as const },
      { ...built, stage: "done" as const },
    ]) {
      expect(workActions(f)).toMatchObject({
        close: false,
        cancel: false,
        draftDesign: false,
      });
    }
  });
});
