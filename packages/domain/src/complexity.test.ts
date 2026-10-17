import { describe, expect, it } from "vitest";

import { canSetComplexity, complexityFloor, effectiveComplexity, escalation, protectedAreas, readAssessment } from "./complexity";
import { domainGuidance } from "./domains";
import { autoAction, workActions, type WorkFacts } from "./flywheel";

const facts = (f: Partial<WorkFacts>): WorkFacts => ({
  stage: "discuss",
  risk: [],
  complexity: "low",
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

describe("complexity floors", () => {
  it("makes money, data, auth and security High, whatever is recommended", () => {
    for (const r of ["money", "data", "auth", "security"] as const) {
      expect(complexityFloor([r])).toBe("high");
      expect(effectiveComplexity("low", ["display", r])).toBe("high");
      expect(canSetComplexity("medium", [r])).toBe(false);
      expect(canSetComplexity("high", [r])).toBe(true);
    }
  });
  it("lets a person choose any tier when nothing protected is touched, below the recommendation too", () => {
    expect(complexityFloor(["display", "content", "code"])).toBe("low");
    expect(effectiveComplexity("low", ["display"])).toBe("low");
    expect(canSetComplexity("low", ["code"])).toBe(true);
  });
});

describe("escalation only goes up", () => {
  it("raises a change that reached a protected area to High, with the reason", () => {
    const up = escalation("low", ["app/page.tsx", "supabase/migrations/0009_x.sql"]);
    expect(up?.complexity).toBe("high");
    expect(up?.reason).toContain("a database migration");
    expect(escalation("medium", ["app/api/stripe/webhook/route.ts"])?.reason).toContain("payments");
    expect(escalation("low", ["app\\login\\page.tsx"])?.reason).toContain("sign-in");
  });
  it("leaves ordinary changes and High items alone", () => {
    expect(escalation("low", ["components/footer.tsx", "components/footer.test.tsx", "components/author-card.tsx"])).toBeNull();
    expect(escalation("high", ["supabase/migrations/0009_x.sql"])).toBeNull();
    expect(protectedAreas(["proxy.ts", ".env.example"]).sort()).toEqual(["environment settings", "request middleware"]);
  });
});

describe("readAssessment: the lead's trailer lines", () => {
  it("splits the assessment off the reply", () => {
    const { reply, assessment } = readAssessment("Found it: a wrong path in the footer.\n\nCOMPLEXITY: Low\nREADY: yes\nREASON: One file, clearly specified.");
    expect(reply).toBe("Found it: a wrong path in the footer.");
    expect(assessment).toEqual({ complexity: "low", ready: true, reason: "One file, clearly specified." });
  });
  it("reads not-ready, and returns no assessment when the tier is missing or unknown", () => {
    expect(readAssessment("Which page?\nCOMPLEXITY: medium\nREADY: no\nREASON: Unclear.").assessment).toMatchObject({ complexity: "medium", ready: false });
    expect(readAssessment("Just a reply.")).toEqual({ reply: "Just a reply.", assessment: null });
    expect(readAssessment("Hi\nCOMPLEXITY: extreme\nREADY: yes").assessment).toBeNull();
  });
});

describe("Low: no decisions, ships through the TDD plane", () => {
  it("waits until the lead says it's ready, or a person begins", () => {
    expect(autoAction(facts({}))).toBeNull();
    expect(workActions(facts({})).begin).toBe(true);
    expect(autoAction(facts({ ready: true }))).toBe("begin");
  });
  it("never asks for a design, plan, Try or Ship it", () => {
    const a = workActions(facts({ ready: true }));
    expect(a).toMatchObject({ draftDesign: false, approveDesign: false, draftPlan: false, approvePlan: false });
    const proven = facts({ ready: true, planApproved: true, steps: [{ status: "done" }], proven: true, stage: "try" });
    expect(workActions(proven)).toMatchObject({ approveTry: false, ship: false, release: false });
  });
  it("builds, proves and ships on its own, in order", () => {
    const step = facts({ ready: true, planApproved: true, steps: [{ status: "todo" }] });
    expect(autoAction(step)).toBe("build_step");
    const built = { ...step, steps: [{ status: "done" as const }] };
    expect(autoAction(built)).toBe("prove");
    expect(autoAction({ ...built, proven: true })).toBe("ship");
  });
  it("repairs a blocked step or a failed Prove itself, within budget, then waits for a person", () => {
    const blocked = (attempts: number) => facts({ ready: true, planApproved: true, steps: [{ status: "blocked", attempts }] });
    expect(autoAction(blocked(1))).toBe("repair_step");
    expect(autoAction(blocked(2))).toBe("repair_step");
    expect(autoAction(blocked(3))).toBeNull(); // two repairs used: a person decides
    const failed = facts({ ready: true, planApproved: true, steps: [{ status: "done" }], proofFailed: true });
    expect(autoAction(failed)).toBe("repair_proof");
    expect(autoAction({ ...failed, proofRepairs: 1 })).toBeNull();
  });
  it("starts nothing while paused, and picks up where it was on resume", () => {
    const step = facts({ ready: true, planApproved: true, steps: [{ status: "todo" }] });
    expect(autoAction({ ...step, paused: true })).toBeNull();
    expect(autoAction(step)).toBe("build_step");
    expect(autoAction({ ...facts({ ready: true }), paused: true })).toBeNull();
  });
  it("never releases twice: after a failed release a person retries", () => {
    const tried = facts({ ready: true, planApproved: true, steps: [{ status: "done" }], proven: true, tryApproved: true });
    expect(autoAction(tried)).toBeNull();
    expect(workActions(tried).release).toBe(true);
  });
});

describe("Medium: the Brief and Ship it", () => {
  const m = (f: Partial<WorkFacts>) => facts({ complexity: "medium", ...f });
  it("drafts the Brief when ready and waits for its approval", () => {
    expect(autoAction(m({ ready: true }))).toBe("design");
    const drafted = m({ ready: true, latestDesign: { version: 1, approved: false } });
    expect(autoAction(drafted)).toBeNull();
    expect(workActions(drafted).approveDesign).toBe(true);
  });
  it("plans and accepts its own plan once the Brief is approved: no plan approval for the client", () => {
    const approved = m({ ready: true, latestDesign: { version: 1, approved: true } });
    expect(autoAction(approved)).toBe("plan");
    const planned = { ...approved, steps: [{ status: "todo" as const }, { status: "todo" as const }] };
    expect(autoAction(planned)).toBe("approve_plan");
    expect(workActions(planned)).toMatchObject({ approvePlan: false, draftPlan: false });
  });
  it("asks for Ship it on the proven preview, unless the standing approval is on", () => {
    const proven = m({ ready: true, latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "done" }], proven: true, stage: "try" });
    expect(autoAction(proven)).toBeNull();
    expect(workActions(proven)).toMatchObject({ ship: true, approveTry: false });
    expect(autoAction({ ...proven, autoShip: true })).toBe("ship");
  });
});

describe("High: the full gates", () => {
  const h = (f: Partial<WorkFacts>) => facts({ complexity: "high", ...f });
  it("drafts the design and plan itself but never approves them", () => {
    expect(autoAction(h({ ready: true }))).toBe("design");
    const approved = h({ ready: true, latestDesign: { version: 1, approved: true } });
    expect(autoAction(approved)).toBe("plan");
    const planned = { ...approved, steps: [{ status: "todo" as const }] };
    expect(autoAction(planned)).toBeNull();
    expect(workActions(planned).approvePlan).toBe(true);
  });
  it("keeps Try and Go live for a person, even with a standing approval set", () => {
    const proven = h({ ready: true, autoShip: true, latestDesign: { version: 1, approved: true }, planApproved: true, steps: [{ status: "done" }], proven: true, stage: "try" });
    expect(autoAction(proven)).toBeNull();
    expect(workActions(proven)).toMatchObject({ approveTry: true, ship: false });
  });
  it("after an escalation from Low, drafts a design before anything else", () => {
    // Low built one step, touched a protected area, and the plan approval was cleared.
    const escalated = h({ ready: true, steps: [{ status: "done" }] });
    expect(autoAction(escalated)).toBe("design");
  });
});

describe("domain guidance", () => {
  it("tells the lead the domain's terms and hotspots, and nothing when no domain is chosen", () => {
    expect(domainGuidance("hospitality")).toContain("rates and availability");
    expect(domainGuidance("commerce")).toContain("checkout and payments");
    expect(domainGuidance(null)).toBe("");
  });
});
