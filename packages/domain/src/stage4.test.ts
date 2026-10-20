import { describe, expect, it } from "vitest";

import { boardingProgress, type BoardingFacts } from "./boarding";
import { capabilitiesTouched, capabilityCondition, capabilityProgress, journeysFor, proposeCapabilities, scorecard, type Capability } from "./capabilities";
import { assembleSkills, CREW, CREW_SKILLS, crewConfigErrors, readCrewConfig, skillsBlock, specialistFor, toolsAllowed } from "./crew";
import { formErrors, INTERVIEW_FORM, interviewBlock, interviewMarkdown, MANDATE_FORM, readForm, readInterview } from "./forms";
import { exportManifest, recordPath, timelineCategory, timelineDays, workRecordMarkdown, type TimelineEntry } from "./library";
import { budgetState, mandateBlock, mandateChanges, mandateErrors, mandateFromDocument, mandateVoids, readMandate } from "./mandate";
import { crewKnowledge } from "./prompts";
import { proposalLabel, skillsmithProposals, type FailureFact } from "./skillsmith";
import { isStripeTestKey, mayCall, toolsFor } from "./toolbelt";

const now = "2026-10-20T12:00:00Z";

describe("crew as configuration (G2.3)", () => {
  it("maps every job kind to one specialist", () => {
    expect(specialistFor("discuss")).toBe("lead");
    expect(specialistFor("design")).toBe("designer");
    expect(specialistFor("build_step")).toBe("builder");
    expect(specialistFor("prove")).toBe("judge");
    expect(specialistFor("release")).toBe("release");
    expect(specialistFor("checkout")).toBe("surveyor");
  });

  it("assembles crew → domain → partner → company → site, and only the site's domain", () => {
    const skills = assembleSkills({
      specialist: "builder", domain: "commerce",
      records: [
        { id: "s1", scope: "site", title: "Machine Shop catalog rules", body: "Read-only MongoDB.", version: 1, specialists: [], enabled: true },
        { id: "o1", scope: "org", title: "Brand voice", body: "Plain.", version: 2, specialists: ["designer"], enabled: true },
        { id: "p1", scope: "partner", title: "Accessibility", body: "WCAG AA.", version: 1, specialists: [], enabled: true },
        { id: "s2", scope: "site", title: "Off", body: "x", version: 1, specialists: [], enabled: false },
      ],
    });
    const tiers = skills.map((s) => s.tier);
    expect(tiers.indexOf("crew")).toBeLessThan(tiers.indexOf("domain"));
    expect(tiers.indexOf("domain")).toBeLessThan(tiers.indexOf("partner"));
    expect(tiers.indexOf("partner")).toBeLessThan(tiers.indexOf("site"));
    expect(skills.some((s) => s.domain === "hospitality")).toBe(false);
    expect(skills.some((s) => s.title === "Brand voice")).toBe(false); // the Designer's, not the Builder's
    expect(skills.some((s) => s.title === "Off")).toBe(false);
    expect(skills.some((s) => s.key === "crew.recommend")).toBe(false); // lead and designer only
  });

  it("never lets a site switch off a safety skill", () => {
    const config = readCrewConfig({ disabledSkills: ["crew.tdd-plane", "crew.small-steps"] });
    expect(crewConfigErrors(config, "commerce")[0]).toMatch(/safety skill/);
    const skills = assembleSkills({ specialist: "builder", domain: null, config });
    expect(skills.some((s) => s.key === "crew.tdd-plane")).toBe(true);
    expect(skills.some((s) => s.key === "crew.small-steps")).toBe(false);
  });

  it("lets a site narrow tools, never widen them", () => {
    expect(crewConfigErrors(readCrewConfig({ tools: { lead: ["rail_note"] } }), null)[0]).toMatch(/never widen/);
    const config = readCrewConfig({ tools: { builder: ["work_status", "rail_note"] } });
    expect(crewConfigErrors(config, null)).toEqual([]);
    expect(toolsAllowed("builder", config)).toEqual(["work_status", "rail_note"]);
    expect(toolsAllowed("designer", config)).toEqual(CREW.designer.tools);
  });

  it("puts safety skills first and says what didn't fit", () => {
    const skills = assembleSkills({ specialist: "lead", domain: "commerce" });
    const block = skillsBlock(skills, 900);
    expect(block.indexOf("TDD plane")).toBeGreaterThan(-1);
    expect(block).toMatch(/more skills? didn't fit/);
    expect(skillsBlock([])).toBe("");
  });

  it("every crew skill has a unique key and the writing standard is a safety skill", () => {
    expect(new Set(CREW_SKILLS.map((s) => s.key)).size).toBe(CREW_SKILLS.length);
    expect(CREW_SKILLS.find((s) => s.key === "crew.writing-standard")?.safety).toBe(true);
  });
});

describe("mandates (§10.1)", () => {
  const m = readMandate({ outcome: "Mobile visitors can request a quote.", acceptance: ["A quote submits on a phone"], scope: ["quote form"], budgetUsd: "25" });

  it("normalizes and validates", () => {
    expect(m.budgetUsd).toBe(25);
    expect(mandateErrors(m)).toEqual([]);
    expect(mandateErrors(readMandate({ outcome: "x" }))).toHaveLength(2);
    expect(mandateErrors(readMandate({ ...m, dueBy: "2026-11-01", reviewBy: "2026-12-01" }))[0]).toMatch(/before it is due/);
  });

  it("voids approvals only for material changes", () => {
    expect(mandateVoids(mandateChanges(m, { ...m, budgetUsd: 50 }))).toEqual([]);
    expect(mandateVoids(mandateChanges(m, { ...m, acceptance: [...m.acceptance, "Works offline"] }))).toContain("ship");
    expect(mandateChanges(null, m).map((c) => c.field)).toEqual(["outcome", "scope", "acceptance", "budgetUsd"]);
  });

  it("tracks spend against the budget", () => {
    expect(budgetState(m, 10).over).toBe(false);
    expect(budgetState(m, 21).near).toBe(true);
    expect(budgetState(m, 25).over).toBe(true);
    expect(budgetState(null, 99).limit).toBeNull();
  });

  it("drafts a mandate from an approved Brief", () => {
    const d = mandateFromDocument(`# Quote form\n\n## Summary (two sentences)\nMobile visitors can ask for a quote.\nIt fixes lost leads.\n\n## What changes\n- the quote form\n- the confirmation\n\n## What stays protected\n- desktop flow\n\n## How we'll prove it\n- a phone-width test submits a quote\n\n## Risks and open questions\nNone`);
    expect(d.outcome).toBe("Mobile visitors can ask for a quote. It fixes lost leads.");
    expect(d.scope).toEqual(["the quote form", "the confirmation"]);
    expect(d.protected).toEqual(["desktop flow"]);
    expect(d.acceptance).toEqual(["a phone-width test submits a quote"]);
  });

  it("is read on every run, with its version", () => {
    const block = mandateBlock({ ...m, version: 3, createdBy: "Pat", createdAt: now });
    expect(block).toMatch(/THE MANDATE \(v3/);
    expect(block).toMatch(/Budget: \$25\.00/);
  });
});

describe("capability inventory (§10.3, G2.3a)", () => {
  // Machine Shop's real layout.
  const files = [
    "app/page.tsx", "app/p/[id]/page.tsx", "app/p/[id]/sheet/page.tsx", "app/p/[id]/sheet/print-sheet.tsx", "app/api/assistant/route.ts",
    "app/api/voice/session/route.ts", "app/api/voice/session/route.test.ts", "app/owner/transcripts/page.tsx", "components/search-box.tsx",
    "components/product-card.tsx", "components/gallery.tsx", "lib/catalog.ts", "lib/product.ts", "lib/product.test.ts", "lib/assistant-tools.ts",
    "lib/assistant-tools.test.ts", "next.config.ts", "public/logo.svg", "scripts/diagnose-voice-db.mjs",
  ];
  const proposals = proposeCapabilities(files, "commerce");
  const key = (k: string) => proposals.find((p) => p.key === k);

  it("proposes Machine Shop's catalog, search, product page, sheets, assistant and voice from its code", () => {
    expect(key("catalog.browse")?.paths).toEqual(expect.arrayContaining(["lib/catalog.ts", "components/gallery.tsx"]));
    expect(key("catalog.search")?.paths).toEqual(["components/search-box.tsx"]);
    expect(key("catalog.product")?.paths).toContain("app/p/[id]/page.tsx");
    expect(key("catalog.sheets")).toBeDefined();
    expect(key("sales.assistant")?.tests).toContain("lib/assistant-tools.test.ts");
    expect(key("sales.voice")?.tests).toContain("app/api/voice/session/route.test.ts");
    expect(key("site.owner")).toBeDefined();
    expect(key("sales.checkout")).toBeUndefined(); // nothing there: nothing proposed
    expect(proposals.some((p) => p.key.startsWith("stay."))).toBe(false);
    expect(proposals.every((p) => p.confidence > 0 && p.confidence <= 0.95 && p.evidence.basis)).toBe(true);
    expect(proposals.flatMap((p) => p.paths).some((p) => p.startsWith("scripts/") || p.startsWith("public/"))).toBe(false);
  });

  it("links a change to the capabilities its files touched", () => {
    const caps = [
      { id: "a", paths: ["lib/product.ts"], lifecycle: "accepted" as const },
      { id: "b", paths: ["components/search-box.tsx"], lifecycle: "retired" as const },
    ];
    expect(capabilitiesTouched(caps, ["lib/product.test.ts", "components/search-box.tsx"])).toEqual([{ id: "a", files: ["lib/product.test.ts"] }]);
  });

  it("keeps condition to evidence: never verified without tests, fresh runs or acceptance", () => {
    const pass = { ok: true, at: "2026-10-19T12:00:00Z", kind: "prove" };
    expect(capabilityCondition({ lifecycle: "accepted", tests: 2 }, pass, now).state).toBe("verified");
    expect(capabilityCondition({ lifecycle: "accepted", tests: 0 }, pass, now).reason).toMatch(/No tests/);
    expect(capabilityCondition({ lifecycle: "accepted", tests: 2 }, { ...pass, at: "2026-09-01T00:00:00Z" }, now).state).toBe("unverified");
    expect(capabilityCondition({ lifecycle: "accepted", tests: 2 }, { ...pass, ok: false }, now).state).toBe("attention");
    expect(capabilityCondition({ lifecycle: "proposed", tests: 2 }, pass, now).state).toBe("unverified");
    expect(capabilityCondition({ lifecycle: "accepted", tests: 2 }, null, now).state).toBe("unverified");
  });

  it("shows progress per Work item and scores without double counting", () => {
    const progress = capabilityProgress([{ number: 3, title: "Search by brand", stage: "build" }, { number: 4, title: "x", stage: "cancelled" }]);
    expect(progress).toEqual([{ number: 3, title: "Search by brand", stage: "Build", phase: "building" }]);
    const cap = (id: string, lifecycle: Capability["lifecycle"], state: Capability["condition"]["state"], critical = false): Capability => ({
      id, key: id, area: "Catalog", name: id, purpose: "", lifecycle, importance: critical ? "critical" : "standard", paths: [], tests: [], requirements: [], version: 1,
      source: "survey", confidence: null, evidence: {}, reviewedBy: null, reviewedAt: null, condition: { state, reason: "", at: null, ageDays: null }, progress,
    });
    const s = scorecard([cap("a", "accepted", "verified"), cap("b", "accepted", "attention", true), cap("c", "proposed", "unverified")]);
    expect(s).toMatchObject({ accepted: 2, proposed: 1, verified: 1, attention: 1, criticalAttention: 1, pipeline: 1 });
  });

  it("lays the domain's critical journey over the inventory", () => {
    const j = journeysFor("commerce", [{ key: "catalog.search", name: "Search", lifecycle: "accepted" }]);
    expect(j[0]!.steps.find((s) => s.key === "catalog.search")?.present).toBe(true);
    expect(j[0]!.steps.find((s) => s.key === "sales.checkout")?.present).toBe(false);
    expect(journeysFor(null, [])).toEqual([]);
  });
});

describe("the Library (G2.5)", () => {
  const e = (id: number, at: string, kind: string, actorKind: TimelineEntry["actorKind"]): TimelineEntry => ({ id, at, kind, actorKind, actor: "x", summary: kind, counts: false, work: null, refs: {} });

  it("groups the timeline by day, newest first, and filters by category", () => {
    const list = [e(1, "2026-10-18T10:00:00Z", "decision", "person"), e(2, "2026-10-19T09:00:00Z", "prove", "crew"), e(3, "2026-10-19T11:00:00Z", "note", "crew")];
    const days = timelineDays(list);
    expect(days.map((d) => d.day)).toEqual(["2026-10-19", "2026-10-18"]);
    expect(days[0]!.entries.map((x) => x.id)).toEqual([3, 2]);
    expect(timelineDays(list, "evidence").flatMap((d) => d.entries.map((x) => x.id))).toEqual([2]);
    expect(timelineCategory(e(4, now, "tier", "policy"))).toBe("decisions");
  });

  it("writes a deterministic Work record under docs/accelerator/", () => {
    const input = {
      site: "Machine Shop",
      work: { number: 7, title: "Search by brand", complexity: "medium" as const, stage: "prove", branch: "work/7" },
      mandate: null,
      document: { kind: "brief" as const, version: 2, body: "# Search by brand\n\n## Summary\nFind by brand.", approvedAt: "2026-10-19T10:00:00Z" },
      steps: [{ position: 1, title: "Add brand filter", status: "done" }],
      decisions: [
        { at: "2026-10-19T10:00:00Z", kind: "approve_design", by: "Pat", via: "typed", target: "brief v2", voided: null },
        { at: "2026-10-18T10:00:00Z", kind: "approve_design", by: "Pat", via: "button", target: "brief v1", voided: "a new Brief" },
      ],
      evidence: [{ at: "2026-10-19T11:00:00Z", kind: "step_checks", ok: true, commit: "abcdef123456", tests: "40/40" }],
    };
    const md = workRecordMarkdown(input);
    expect(md).toBe(workRecordMarkdown(input));
    expect(md).toMatch(/## Brief \(v2, approved 2026-10-19\)/);
    expect(md).toMatch(/1 decision\(s\) were voided/);
    expect(md).toMatch(/`abcdef12`/);
    expect(recordPath(7)).toBe("docs/accelerator/work-7.md");
  });

  it("states what an export leaves out", () => {
    const m = exportManifest({ site: { slug: "ms", name: "MS", url: "https://x" }, at: now, by: "Pat", tables: { decisions: [1, 2], ledger: [] } });
    expect(m.counts).toEqual({ decisions: 2, ledger: 0 });
    expect(m.notes.join(" ")).toMatch(/never exported/);
  });
});

describe("the Skillsmith v0 (§2.1)", () => {
  const f = (work: number, reasons: string[], kind: FailureFact["kind"] = "step_checks", at = "2026-10-15T00:00:00Z"): FailureFact => ({ work, title: `#${work}`, at, kind, ok: false, reasons });

  it("proposes once a pattern repeats across Work items, with its evidence", () => {
    const failures = [f(1, ["No tests were added or updated, and no reason was given."]), f(1, ["No tests were added or updated, and no reason was given."])];
    expect(skillsmithProposals({ failures, escalations: [], now, open: [] })).toEqual([]); // one item is not a pattern
    const p = skillsmithProposals({ failures: [...failures, f(4, ["No tests were added or updated, and no reason was given."])], escalations: [], now, open: [] });
    expect(p).toHaveLength(1);
    expect(p[0]!.rule).toBe("tests-with-every-change");
    expect(p[0]!.evidence.items).toEqual([1, 4]);
    expect(p[0]!.rationale).toMatch(/3 runs on 2 Work items/);
  });

  it("doesn't repeat an open proposal and ignores old evidence", () => {
    const failures = [f(1, ["Typecheck failed."]), f(2, ["Typecheck failed."], "prove")];
    expect(skillsmithProposals({ failures, escalations: [], now, open: ["typecheck-before-finish"] })).toEqual([]);
    expect(skillsmithProposals({ failures: failures.map((x) => ({ ...x, at: "2026-01-01T00:00:00Z" })), escalations: [], now, open: [] })).toEqual([]);
  });

  it("turns repeated escalations in one area into a Team Lead skill", () => {
    const p = skillsmithProposals({ failures: [], escalations: [{ work: 2, at: now, files: ["app/checkout/page.tsx"] }, { work: 5, at: now, files: ["app/checkout/pay.ts"] }], now, open: [] });
    expect(p[0]).toMatchObject({ rule: "escalation:app/checkout", specialists: ["lead"] });
  });

  it("keeps proposed, activated and evaluated distinct", () => {
    expect(proposalLabel({ status: "proposed", evaluation: "not evaluated" })).toBe("Proposed · not evaluated");
    expect(proposalLabel({ status: "approved", evaluation: "not evaluated" })).toBe("Activated · not evaluated");
  });
});

describe("forms (§9.5)", () => {
  it("normalizes to the spec and validates", () => {
    const v = readForm(MANDATE_FORM, { outcome: " Quotes on phones ", acceptance: "- submits\n\n- confirms", budgetUsd: "40", bogus: "x" });
    expect(v).toMatchObject({ outcome: "Quotes on phones", acceptance: ["submits", "confirms"], budgetUsd: 40 });
    expect("bogus" in v).toBe(false);
    expect(formErrors(MANDATE_FORM, v)).toEqual({});
    expect(formErrors(MANDATE_FORM, readForm(MANDATE_FORM, { budgetUsd: 0 }))).toHaveProperty("budgetUsd");
  });

  it("round-trips the interview, even with comment-closing text in an answer", () => {
    const v = readForm(INTERVIEW_FORM, { outcomes: "More quotes", journeys: "Search → quote", brand: "Plain --> direct", monthlyBudgetUsd: 200 });
    const md = interviewMarkdown(v);
    expect(md.slice(md.indexOf("<!-- answers")).match(/-->/g)).toHaveLength(1);
    expect(readInterview(md)).toEqual(v);
    expect(interviewBlock(v)).toMatch(/Critical journeys/);
    expect(readInterview("# nothing")).toBeNull();
  });
});

describe("Boarding (§2.5, G2.6)", () => {
  const facts: BoardingFacts = {
    scanned: true, repo: true, repoPath: true, items: { C1: "done", C2: "done", C4: "waiting", I5: "done" }, censusAt: null,
    capabilities: { proposed: 0, accepted: 0 }, domain: true, interviewAt: null, crewVersion: 0, baselineTests: 40, released: 0, agreementSigned: false,
  };

  it("computes each step from records and names the next action and who does it", () => {
    const b = boardingProgress(facts);
    expect(b.priceUsd).toBe(2500);
    expect(b.steps.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo", "todo", "todo"]);
    expect(b.next).toEqual({ step: "Connect", label: "Every key in the manifest is set for Development (C4)", who: "You" });
  });

  it("is complete only when every step's records exist", () => {
    const all = boardingProgress({
      ...facts, items: { C1: "done", C2: "done", C4: "not_needed", I5: "done" }, censusAt: now, capabilities: { proposed: 2, accepted: 3 },
      interviewAt: now, crewVersion: 1, released: 1, agreementSigned: true,
    });
    expect(all.complete).toBe(true);
    expect(all.next).toBeNull();
  });
});

describe("Toolbelt disclosure and crew narrowing (G2.2b)", () => {
  it("shows a tool only at its stops and within the crew's allowance, and enforces the same on call", () => {
    expect(toolsFor("build", { stage: "build" }).map((t) => t.name)).toContain("stripe_test_catalog");
    expect(toolsFor("build", { stage: "discuss" }).map((t) => t.name)).not.toContain("stripe_test_catalog");
    expect(toolsFor("consult").map((t) => t.name)).not.toContain("stripe_test_catalog");
    expect(mayCall("build", "rail_note", { allowed: ["work_status"] })).toBe(false);
    expect(mayCall("build", "work_status", { allowed: ["work_status"], stage: "build" })).toBe(true);
  });

  it("accepts only Stripe test keys", () => {
    expect(isStripeTestKey("sk_test_abc123")).toBe(true);
    expect(isStripeTestKey("rk_test_abc123")).toBe(true);
    expect(isStripeTestKey("sk_live_abc123")).toBe(false);
    expect(isStripeTestKey("")).toBe(false);
  });
});

describe("what each run knows", () => {
  it("adds the interview, mandate and skills to the prompt", () => {
    const skills = assembleSkills({ specialist: "lead", domain: "commerce" });
    const text = crewKnowledge({
      job: {} as never, site: {} as never, work: null, toolbeltToken: null,
      crew: { specialist: "lead", label: "Team Lead", crewVersion: 2, skills },
      mandate: { ...readMandate({ outcome: "Quotes on phones work.", acceptance: ["submits"] }), version: 1, createdBy: "Pat", createdAt: now },
      interview: readForm(INTERVIEW_FORM, { outcomes: "More quotes" }),
    });
    expect(text).toMatch(/THE SITE/);
    expect(text).toMatch(/THE MANDATE \(v1/);
    expect(text).toMatch(/Commerce: the catalog feeds everything/);
    expect(crewKnowledge({ job: {} as never, site: {} as never, work: null, toolbeltToken: null })).toBe("");
  });
});
