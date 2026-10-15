import { describe, expect, it } from "vitest";
import { decisionAccessReason } from "./decision-access";
describe("contextual decision access explanations", () => {
  it.each(["partner", "support"] as const)(
    "explains %s access even with an Owner role",
    (via) => {
      expect(
        decisionAccessReason({ via, role: "owner", risk: [], gate: "design" }),
      ).toContain(
        "platform admin status does not grant client approval authority",
      );
    },
  );
  it.each(["design", "plan", "try", "release", "execute"] as const)(
    "explains a viewer's blocked %s action",
    (gate) => {
      expect(
        decisionAccessReason({ via: "member", role: "viewer", risk: [], gate }),
      ).toContain("role cannot approve");
    },
  );
  it("keeps direct account Owner authority even if that person also has platform powers", () => {
    expect(
      decisionAccessReason({
        via: "member",
        role: "owner",
        risk: ["money"],
        gate: "try",
      }),
    ).toBeNull();
  });
  it("does not incorrectly require an Owner for design approval", () => {
    expect(
      decisionAccessReason({
        via: "member",
        role: "operator",
        risk: ["money"],
        gate: "design",
      }),
    ).toBeNull();
  });
  it("explains protected preview approval and tester release limits", () => {
    expect(
      decisionAccessReason({
        via: "member",
        role: "operator",
        risk: ["data"],
        gate: "try",
      }),
    ).toContain("Owner must approve");
    expect(
      decisionAccessReason({
        via: "member",
        role: "tester",
        risk: [],
        gate: "release",
      }),
    ).toContain("cannot release to production");
  });
});
