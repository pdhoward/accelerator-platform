import { describe, expect, it } from "vitest";

import { canApprove } from "./gates";
import { canPlatform, canSite } from "./permissions";
import { budgetUsed, median } from "./metrics";

describe("canApprove", () => {
  it("never lets a viewer approve", () => expect(canApprove("viewer", ["display"])).toBe(false));
  it("reserves money approvals for the owner", () => {
    expect(canApprove("operator", ["money"])).toBe(false);
    expect(canApprove("owner", ["money"])).toBe(true);
  });
});

describe("metrics", () => {
  it("computes a median", () => expect(median([5, 1, 3, 2])).toBe(2.5));
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
