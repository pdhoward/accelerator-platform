import { describe, expect, it } from "vitest";

import { pendingDecision, readIntent, type DecisionFacts } from "./decisions";

const none = { approveDesign: false, approvePlan: false, approveTry: false, ship: false, release: false, close: false };
const facts = (f: Partial<Omit<DecisionFacts, "actions">> & { actions?: Partial<DecisionFacts["actions"]> }): DecisionFacts => ({
  complexity: "medium",
  risk: [],
  latestDesignVersion: null,
  candidate: null,
  ...f,
  actions: { ...none, ...f.actions },
});

describe("pendingDecision: the one card in the conversation", () => {
  it("names a Medium Brief and binds the version it shows", () => {
    const d = pendingDecision(facts({ latestDesignVersion: 2, actions: { approveDesign: true } }));
    expect(d).toMatchObject({ kind: "approve_brief", key: "approve_brief:v2", title: "Approve the Brief (v2)", ownerOnly: false });
    expect(pendingDecision(facts({ complexity: "high", latestDesignVersion: 3, actions: { approveDesign: true } }))?.key).toBe("approve_design:v3");
  });
  it("binds Ship it to the exact candidate commit, so a newer build needs a fresh look", () => {
    const a = pendingDecision(facts({ candidate: "abc12345ffff", actions: { ship: true } }));
    const b = pendingDecision(facts({ candidate: "def67890aaaa", actions: { ship: true } }));
    expect(a).toMatchObject({ kind: "ship", title: "Ship it (abc12345)", needsRelease: true });
    expect(a?.key).not.toBe(b?.key);
  });
  it("marks money, data, auth and security decisions as button-only", () => {
    expect(pendingDecision(facts({ complexity: "high", risk: ["money"], candidate: "abc", actions: { approveTry: true } }))?.ownerOnly).toBe(true);
    expect(pendingDecision(facts({ risk: ["money"], actions: { close: true } }))?.ownerOnly).toBe(false);
  });
  it("has nothing pending while the crew works on its own", () => {
    expect(pendingDecision(facts({}))).toBeNull();
  });
});

describe("readIntent: only short, exact phrases act", () => {
  it("reads approvals, pauses and resumes", () => {
    for (const t of ["Approve", "approved.", "Ship it!", "yes, ship it", "go live", "Approve the Brief"]) expect(readIntent(t)).toBe("approve");
    for (const t of ["stop", "Pause!", "hold on", "wait"]) expect(readIntent(t)).toBe("pause");
    for (const t of ["resume", "carry on", "keep going"]) expect(readIntent(t)).toBe("resume");
  });
  it("leaves everything else to the lead, including a bare yes", () => {
    for (const t of ["yes", "go", "ok", "I approve of the colour but change the font", "don't ship it yet", "can you stop using that library?", ""]) {
      expect(readIntent(t)).toBeNull();
    }
  });
});
