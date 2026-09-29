import { describe, expect, it } from "vitest";

import { canApprove, canShip, requiredGates } from "./gates";
import { canMove } from "./loop";
import { canPlatform, canSite } from "./permissions";
import { backlogHalfLifeDays, budgetUsed, firstPassRate, median } from "./metrics";

const green = [{ label: "tests", status: "pass" as const }];

describe("requiredGates", () => {
  it("lets an AC1 content change ship on evidence alone", () => {
    expect(requiredGates({ risk: ["content"], level: "AC1" })).toEqual([]);
  });
  it("requires a try for any AC2 change, even display-only", () => {
    expect(requiredGates({ risk: ["display"], level: "AC2" })).toEqual(["try"]);
  });
  it("always requires the owner for money, even at AC1", () => {
    expect(requiredGates({ risk: ["money"], level: "AC1" })).toEqual(["try", "owner-approval"]);
  });
  it("adds a data preview for data changes", () => {
    expect(requiredGates({ risk: ["data"], level: "AC2" })).toEqual(["try", "owner-approval", "data-preview"]);
  });
  it("treats an unclassified change as risky (never ships on evidence)", () => {
    expect(requiredGates({ risk: [], level: "AC1" })).toEqual(["try"]);
  });
});

describe("canShip", () => {
  it("blocks when evidence has a warning", () => {
    const r = canShip({ risk: ["content"], level: "AC1", evidence: [{ label: "x", status: "warn" }], tried: false, approvals: [] });
    expect(r.canShip).toBe(false);
  });
  it("blocks a money change approved only by an operator", () => {
    const r = canShip({ risk: ["money"], level: "AC2", evidence: green, tried: true, approvals: [{ role: "operator" }] });
    expect(r.canShip).toBe(false);
    expect(r.blockers[0]).toMatch(/Owner/);
  });
  it("ships a tried display change", () => {
    expect(canShip({ risk: ["display"], level: "AC2", evidence: green, tried: true, approvals: [] }).canShip).toBe(true);
  });
});

describe("canApprove", () => {
  it("never lets a viewer approve", () => expect(canApprove("viewer", ["display"])).toBe(false));
  it("reserves money approvals for the owner", () => {
    expect(canApprove("operator", ["money"])).toBe(false);
    expect(canApprove("owner", ["money"])).toBe(true);
  });
});

describe("loop", () => {
  it("moves forward one step at a time", () => {
    expect(canMove("prove", "try")).toBe(true);
    expect(canMove("build", "ship")).toBe(false);
  });
  it("allows a send-back from try to build", () => expect(canMove("try", "build")).toBe(true));
});

describe("metrics", () => {
  it("computes a median", () => expect(median([5, 1, 3, 2])).toBe(2.5));
  it("computes first-pass rate", () => expect(firstPassRate([{ sendBacks: 0 }, { sendBacks: 1 }])).toBe(50));
  it("computes backlog half-life", () => expect(backlogHalfLifeDays(12, 0.7)).toBe(9));
  it("caps budget use at 100", () => expect(budgetUsed(900, 500)).toBe(100));
});


describe("permissions", () => {
  it("lets platform staff view but not suspend", () => {
    expect(canPlatform("staff", "platform.view")).toBe(true);
    expect(canPlatform("staff", "accounts.suspend")).toBe(false);
  });
  it("reserves team management for the platform owner", () => {
    expect(canPlatform("admin", "team.manage")).toBe(false);
    expect(canPlatform("owner", "team.manage")).toBe(true);
  });
  it("denies everything without a platform role", () => expect(canPlatform(null, "platform.view")).toBe(false));
  it("lets operators release to production but not testers", () => {
    expect(canSite("operator", "release.ship")).toBe(true);
    expect(canSite("tester", "release.ship")).toBe(false);
  });
  it("keeps billing with the account owner", () => expect(canSite("operator", "billing.manage")).toBe(false));
  it("lets viewers only view", () => expect(canSite("viewer", "request.create")).toBe(false));
});
