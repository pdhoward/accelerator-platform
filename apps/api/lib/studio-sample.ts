import {
  boardingProgress,
  capabilityCondition,
  capabilityProgress,
  DEFAULT_MODELS,
  journeysFor,
  pendingDecision,
  proposeCapabilities,
  resolveModels,
  scorecard,
  workActions,
  type Boarding,
  type CapabilitiesResponse,
  type Capability,
  type InstrumentInputs,
  type TimelineEntry,
  type TimelineResponse,
  type WorkDetail,
  type WorkItem,
} from "@accelerator/domain";

/**
 * The keyless demo's story (G2.4: the demo tenant is Machine Shop): an online
 * home-and-hardware shop whose owner, Morgan, runs it with the Accelerator.
 * Three Work items show the platform's promise: every decision is recorded
 * and traceable, the crew follows the Protocol (tests, repairs, proof), and
 * the owner stays in the loop exactly where it matters.
 *   #1 High: email a product sheet. Proven; waiting on Morgan's release decision.
 *   #2 Low:  blurry product images on phones. The crew fixed, proved and shipped it.
 *   #3 Medium: search by brand. The Brief waits for Morgan's approval.
 * Synthetic and read-only: never persisted, never shown as a real site's evidence.
 */

const DAY = Date.UTC(2026, 9, 15, 9, 0);
const t = (hours: number) => new Date(DAY + hours * 3_600_000).toISOString();
const models = resolveModels(DEFAULT_MODELS);
const OWNER = "Morgan (Owner)";

const base = (w: Partial<WorkItem> & Pick<WorkItem, "id" | "number" | "title" | "stage" | "complexity">): WorkItem => ({
  kind: "change", risk: [], recommendedComplexity: w.complexity, complexityReason: null, complexitySetBy: "platform", ready: true, autoShip: false,
  paused: false, proofRepairs: 0, branch: `work/${w.number}`, planApproved: false, previewUrl: null, proof: null, tryApproved: false, released: false,
  release: null, createdAt: t(0), updatedAt: t(1), ...w,
});

const job = (id: string, kind: WorkDetail["jobs"][number]["kind"], role: keyof typeof models, at: number) => ({
  id, kind, status: "done" as const, provider: models[role].provider, model: models[role].model, error: null, createdAt: t(at), startedAt: t(at), finishedAt: t(at + 0.2),
});

const msg = (id: string, who: "person" | "model" | "system", label: string, stage: string, body: string, at: number) => ({
  id, authorKind: who, authorLabel: label, model: who === "model" ? models.consult.model : null, stage, body, createdAt: t(at),
});

/** Finishes a detail: actions and the pending decision come from the same domain rules as a real item. */
function detail(d: Omit<WorkDetail, "actions" | "crewNext" | "decision" | "models" | "runnerOnline" | "events">): WorkDetail {
  const w = d.work;
  const latest = d.designs.at(-1);
  const actions = workActions({
    stage: w.stage, risk: w.risk, complexity: w.complexity, ready: w.ready, autoShip: w.autoShip, paused: w.paused, proofRepairs: w.proofRepairs,
    jobRunning: false, latestDesign: latest ? { version: latest.version, approved: !!latest.approvedAt } : null, planApproved: w.planApproved,
    steps: d.steps, proven: w.proof?.ok === true, proofFailed: !!w.proof && !w.proof.ok, tryApproved: w.tryApproved, released: w.released,
  });
  const decision = pendingDecision({ complexity: w.complexity, risk: w.risk, latestDesignVersion: latest?.version ?? null, candidate: w.proof?.commit ?? null, actions });
  return { ...d, actions, crewNext: null, decision, models, runnerOnline: false, events: [] };
}

function itemEmailSheet(): WorkDetail {
  const work = base({
    id: "sample-sheet", number: 1, title: "Let shoppers email a product sheet to themselves", stage: "try", risk: ["data"], complexity: "high",
    complexityReason: "It collects a shopper's email address: personal data needs the Owner's decision.", planApproved: true, branch: "work/1",
    proof: {
      ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 46, failed: 0, total: 46 }, baseline: 41, pushed: true, previewState: "success",
      branch: "work/1", commit: "7c41e9a2", previewUrl: null, previewStatus: null, at: t(30),
    },
    createdAt: t(0), updatedAt: t(30),
  });
  return detail({
    work,
    jobs: [job("s1-prove", "prove", "judge", 29), job("s1-build2", "build_step", "build", 26), job("s1-build1", "build_step", "build", 20), job("s1-plan", "plan", "plan", 8), job("s1-design", "design", "design", 2)],
    messages: [
      msg("s1-m1", "person", OWNER, "discuss", "Shoppers ask us to send them the spec sheet for a product so they can show it at home. Can we add 'Email me this sheet' on the product page?", 0),
      msg("s1-m2", "model", "Team Lead", "discuss", "Yes. This collects an email address, so I rate it High: you approve the design, the plan and the release. I'll keep the catalog read-only and send only the sheet the shopper is looking at. The Designer drafts it now.", 0.3),
      msg("s1-m3", "model", "Designer", "design", "Design v1 is ready: one field under the sheet, a confirmation, no marketing list, and the address deleted after sending.", 2.2),
      msg("s1-m4", "person", OWNER, "design", "approve the design", 4),
      msg("s1-m5", "system", "Crew", "build", "Step 1 didn't pass its checks: 1 test failing. The crew is fixing it (repair 1 of 2).", 21),
      msg("s1-m6", "model", "Builder", "prove", "Proven: typecheck clean, 46/46 tests passing (the site's baseline was 41), production build ok. The preview is up. Try it, then approve it for release.", 30),
    ],
    designs: [{
      id: "s1-d1", version: 1, authorLabel: "Designer", model: models.design.model, createdAt: t(2), approvedAt: t(4),
      body: "# Email me this sheet\n\n## Goal\nShoppers send a product's sheet to their own inbox, so they can share it at home.\n\n## What we agreed\n1. One email field under the product sheet, with a clear confirmation.\n2. No marketing list: the address is used once and deleted after sending.\n3. The catalog stays read-only.\n\n## How we'll prove it\n- A test sends the sheet for a real catalog product to a test inbox.\n- A test proves the address isn't stored after sending.\n- A test proves a bad address shows a clear correction.\n\n## Risks and open questions\nPersonal data: the Owner approves the release.",
    }],
    steps: [
      { id: "s1-st1", position: 1, title: "Add the email field and its validation", detail: "Field, validation and confirmation; tests for bad addresses.", status: "done", attempts: 2, evidence: { summary: "Field and validation added; repaired one failing test.", files: ["app/p/[id]/sheet/email-sheet.tsx", "lib/email-sheet.test.ts"], commit: "51b0c3d7" } },
      { id: "s1-st2", position: 2, title: "Send the sheet and forget the address", detail: "Send through the test mail account; prove nothing is stored.", status: "done", attempts: 1, evidence: { summary: "Sheet sent to the test inbox; address deleted after sending.", files: ["app/api/sheet/email/route.ts", "app/api/sheet/email/route.test.ts"], commit: "7c41e9a2" } },
    ],
    mandate: {
      version: 1, createdBy: OWNER, createdAt: t(4.5),
      outcome: "Shoppers can email a product sheet to themselves; no address is kept.",
      scope: ["Email field on the product sheet", "Sending the sheet"], outOfScope: ["Marketing lists", "Shopper accounts"],
      acceptance: ["A real product's sheet arrives in the test inbox", "No address is stored after sending", "A bad address shows a clear correction"],
      protected: ["The catalog stays read-only", "The assistant mentions only products the catalog returns"],
      budgetUsd: 25, dueBy: null, decisionOwners: "Morgan decides releases and anything touching personal data.", reviewBy: null,
    },
    budget: { limit: 25, spent: 11.4, over: false, near: false },
    capabilities: [{ id: "cap-sheets", name: "Product sheets", area: "Catalog" }],
  });
}

function itemImages(): WorkDetail {
  const work = base({
    id: "sample-images", number: 2, title: "Fix blurry product images on phones", stage: "done", complexity: "low",
    complexityReason: "Display only: no data, money or sign-in.", planApproved: true, tryApproved: true, released: true,
    proof: { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 41, failed: 0, total: 41 }, baseline: 39, pushed: true, previewState: "success", branch: "work/2", commit: "2fa8d610", previewUrl: null, previewStatus: null, at: t(-30) },
    release: { ok: true, reasons: [], stageCommit: "2fa8d610", mainCommit: "2fa8d610", productionState: "success", liveUrl: "https://machineshop.example", liveStatus: 200, at: t(-29) },
    createdAt: t(-34), updatedAt: t(-29),
  });
  return detail({
    work,
    jobs: [job("s2-release", "release", "build", -29.5), job("s2-prove", "prove", "judge", -30.5), job("s2-build", "build_step", "build", -32)],
    messages: [
      msg("s2-m1", "person", OWNER, "discuss", "Product photos look blurry on my phone.", -34),
      msg("s2-m2", "model", "Team Lead", "discuss", "Low complexity: display only. I'll fix it, prove it and ship it. You'll see it live.", -33.8),
      msg("s2-m3", "system", "Crew", "release", "Low complexity: every check in the TDD plane passed, so this ships now.", -30),
      msg("s2-m4", "model", "Release", "learn", "Live. Production deployed and the site answers 200. 41/41 tests passing.", -29),
    ],
    designs: [],
    steps: [{ id: "s2-st1", position: 1, title: "Fix blurry product images on phones", detail: "Serve images at the phone's pixel density; add a test.", status: "done", attempts: 1, evidence: { summary: "Responsive image sizes; test added.", files: ["components/product-card.tsx", "lib/product.test.ts"], commit: "2fa8d610" } }],
    mandate: null,
    budget: { limit: null, spent: 1.9, over: false, near: false },
    capabilities: [{ id: "cap-browse", name: "Browse the catalog", area: "Catalog" }],
  });
}

function itemBrand(): WorkDetail {
  const work = base({
    id: "sample-brand", number: 3, title: "Search by brand", stage: "design", complexity: "medium",
    complexityReason: "Changes how search reads the catalog; no money or personal data.", createdAt: t(40), updatedAt: t(42),
  });
  return detail({
    work,
    jobs: [job("s3-brief", "design", "design", 41.5)],
    messages: [
      msg("s3-m1", "person", OWNER, "discuss", "Shoppers type a brand name and get mixed results. Can search find brands?", 40),
      msg("s3-m2", "model", "Team Lead", "discuss", "Medium: it changes how search reads the catalog. The Designer writes a short Brief; you approve it once, and the crew plans, builds and proves on its own.", 40.3),
      msg("s3-m3", "model", "Designer", "design", "The Brief (v1) is ready. Approve it and the crew plans, builds and proves it on its own.", 41.7),
    ],
    designs: [{
      id: "s3-d1", version: 1, authorLabel: "Designer", model: models.design.model, createdAt: t(41.7), approvedAt: null,
      body: "# Search by brand\n\n## Summary\nA brand name in the search box lists that brand's products first. Shoppers find what they came for faster.\n\n## What changes\n- Search matches the brand field as well as the name\n- Brand matches rank first\n\n## What stays protected\n- The catalog stays read-only\n- Every list stays paginated\n\n## How we'll prove it\n- A test searches a real brand and gets only its products first\n- A test proves results stay paginated\n\n## Risks and open questions\nNone",
    }],
    steps: [],
    mandate: null,
    budget: { limit: null, spent: 0.6, over: false, near: false },
    capabilities: [{ id: "cap-search", name: "Search", area: "Catalog" }],
  });
}

/** Every sample Work item, newest first. */
export const sampleItems = (): WorkDetail[] => [itemBrand(), itemImages(), itemEmailSheet()];

/** One sample Work item by number (1 is the one waiting on a release decision). */
export function studioSample(number = 1): WorkDetail {
  const found = sampleItems().find((d) => d.work.number === number);
  if (!found) throw new Error(`No sample item #${number}.`);
  return found;
}

/** The sample's ledger: what a real site's Change Ledger records, in order. */
function sampleLedger(): (Omit<TimelineEntry, "id" | "refs" | "work"> & { work: number | null })[] {
  const p = (at: number, work: number | null, kind: string, summary: string, counts = true) => ({ at: t(at), kind, actorKind: "person" as const, actor: OWNER, counts, work, summary });
  const c = (at: number, work: number | null, actor: string, kind: string, summary: string, counts = false) => ({ at: t(at), kind, actorKind: "crew" as const, actor, counts, work, summary });
  const pol = (at: number, work: number, summary: string) => ({ at: t(at), kind: "decision", actorKind: "policy" as const, actor: "Low-complexity policy", counts: true, work, summary });
  return [
    p(-40, null, "interview", "Site interview v1 saved: outcomes, critical journeys, never-break rules, who decides."),
    c(-39.5, null, "Surveyor", "survey", "Capability survey: 8 proposed from 52 files (commerce)."),
    p(-39, null, "capability", "Catalog, Search, Product page and Product sheets accepted into the inventory."),
    p(-38.5, null, "crew", "Crew v1 saved: the Commerce domain pack on, the Builder's tools narrowed."),
    c(-33.8, 2, "Team Lead", "assessed", "Rated Low complexity: display only."),
    c(-33.7, 2, "Team Lead", "handoff", "Team Lead → Builder: build the next step."),
    c(-32, 2, "Builder", "step_checks", "Step built and checked: responsive image sizes (41/41 tests).", true),
    c(-31, 2, "Builder", "handoff", "Builder → Judge: prove the candidate."),
    c(-30.5, 2, "Judge", "prove", "Proven: every check passed and the preview is up (2fa8d610).", true),
    pol(-30, 2, "#2 shipped under the Low-complexity policy: every check passed."),
    c(-29, 2, "Release", "release", "Live: https://machineshop.example answers 200.", true),
    c(0.3, 1, "Team Lead", "assessed", "Rated High complexity: it collects a shopper's email address."),
    c(2.2, 1, "Designer", "drafted", "Design v1 drafted for #1."),
    p(4, 1, "decision", "Approved design v1 (typed in the conversation)."),
    p(4.5, 1, "decision", "Mandate v1 set for #1: outcome, acceptance, protected behavior, $25 budget."),
    c(8, 1, "Planner", "drafted", "Plan of 2 steps drafted for #1."),
    p(9, 1, "decision", "Approved the plan (2 steps)."),
    c(9.2, 1, "Planner", "handoff", "Planner → Builder: build the next step under mandate v1."),
    c(20, 1, "Builder", "step_checks", "Step blocked by the Protocol: 1 test failing."),
    c(20.5, 1, "Builder", "repair", "Repairing step 1 of #1 (repair 1 of 2)."),
    c(21, 1, "Builder", "step_checks", "Step built and checked: email field and validation (44/44 tests).", true),
    c(26, 1, "Builder", "step_checks", "Step built and checked: sheet sent, address not stored (46/46 tests).", true),
    c(28, 1, "Librarian", "note", "Record written to docs/accelerator/work-1.md on work/1."),
    c(29, 1, "Judge", "prove", "Proven: every check passed and the preview is up (7c41e9a2).", true),
    c(40.3, 3, "Team Lead", "assessed", "Rated Medium complexity: changes how search reads the catalog."),
    c(41.7, 3, "Designer", "drafted", "Brief v1 drafted for #3."),
    c(42, null, "Skillsmith", "skill", "Proposed \"Add a test with every change on this site\": 3 runs on 2 Work items failed the same way."),
  ];
}

/** The Site Timeline in the demo, newest first. */
export function timelineSample(): TimelineResponse {
  const titles = new Map(sampleItems().map((d) => [d.work.number, d.work.title]));
  const entries = sampleLedger()
    .map((e, i): TimelineEntry => ({ ...e, id: i + 1, refs: {}, work: e.work ? { number: e.work, title: titles.get(e.work)! } : null }))
    .reverse();
  return { entries, next: null, filter: "all" };
}

/**
 * Synthetic, read-only records for the Cockpit Dial in keyless demo mode.
 * Labelled "sample" by the API; never persisted or used as live evidence.
 */
export function instrumentsSample(now: string): Omit<InstrumentInputs, "scope"> {
  const shift = Date.parse(now) - (DAY + 44 * 3_600_000); // the story ends "now"
  const at = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
  const items = sampleItems();
  return {
    now,
    baselineTests: 41,
    work: items.map((d) => ({
      number: d.work.number, title: d.work.title, kind: "change" as const, stage: d.work.stage, complexity: d.work.complexity, createdAt: at(d.work.createdAt),
      released: d.work.released, releasedAt: d.work.release ? at(d.work.release.at) : null, paused: false,
      pending: d.decision ? { title: d.decision.title, since: at(d.work.updatedAt) } : null,
    })),
    evidence: [
      { kind: "step_checks", ok: true, commit: "2fa8d610", passed: 41, failed: 0, total: 41, at: at(t(-32)), work: 2, step: "s2-st1", detail: {} },
      { kind: "prove", ok: true, commit: "2fa8d610", passed: 41, failed: 0, total: 41, at: at(t(-30.5)), work: 2, step: null, detail: {} },
      { kind: "release", ok: true, commit: "2fa8d610", passed: null, failed: null, total: null, at: at(t(-29)), work: 2, step: null, detail: {} },
      { kind: "step_checks", ok: false, commit: "51b0c3d0", passed: 43, failed: 1, total: 44, at: at(t(20)), work: 1, step: "s1-st1", detail: {} },
      { kind: "step_checks", ok: true, commit: "51b0c3d7", passed: 44, failed: 0, total: 44, at: at(t(21)), work: 1, step: "s1-st1", detail: {} },
      { kind: "step_checks", ok: true, commit: "7c41e9a2", passed: 46, failed: 0, total: 46, at: at(t(26)), work: 1, step: "s1-st2", detail: {} },
      { kind: "prove", ok: true, commit: "7c41e9a2", passed: 46, failed: 0, total: 46, at: at(t(29)), work: 1, step: null, detail: {} },
      {
        kind: "census", ok: true, commit: "7c41e9a2", passed: null, failed: null, total: null, at: at(t(29)), work: 1, step: null,
        detail: { files: 52, lines: 6140, functions: 171, components: 21, routes: 12, tests: 14, hotspots: [{ path: "lib/product.ts", branches: 31, lines: 240 }, { path: "lib/catalog.ts", branches: 18, lines: 160 }] },
      },
    ],
    ledger: sampleLedger().map((e) => ({ at: at(e.at), kind: e.kind, actorKind: e.actorKind, actorLabel: e.actor, counts: e.counts, work: e.work, summary: e.summary })),
  };
}

/** Machine Shop's repository, as the Surveyor sees it (file names only). */
const SAMPLE_FILES = [
  "app/page.tsx", "app/layout.tsx", "app/p/[id]/page.tsx", "app/p/[id]/sheet/page.tsx", "app/p/[id]/sheet/print-sheet.tsx", "app/p/[id]/sheet/email-sheet.tsx",
  "app/api/assistant/route.ts", "app/api/voice/session/route.ts", "app/api/voice/session/route.test.ts", "app/api/sheet/email/route.ts",
  "app/api/sheet/email/route.test.ts", "app/owner/transcripts/page.tsx", "components/search-box.tsx", "components/gallery.tsx", "components/product-card.tsx",
  "components/assistant.tsx", "components/voice-call.tsx", "lib/catalog.ts", "lib/product.ts", "lib/product.test.ts", "lib/assistant-tools.ts",
  "lib/assistant-tools.test.ts", "lib/email-sheet.test.ts",
];

/** The capability inventory in the demo: the Survey's proposals, four accepted, with condition and progress. */
export function capabilitiesSample(now: string): CapabilitiesResponse {
  const accepted = new Set(["catalog.browse", "catalog.search", "catalog.product", "catalog.sheets"]);
  const ids: Record<string, string> = { "catalog.browse": "cap-browse", "catalog.search": "cap-search", "catalog.sheets": "cap-sheets" };
  const items = sampleItems();
  const latestSuite = { ok: true, at: new Date(Date.parse(now) - 15 * 3_600_000).toISOString(), kind: "prove" };
  const caps: Capability[] = proposeCapabilities(SAMPLE_FILES, "commerce").map((p) => {
    const id = ids[p.key] ?? `cap-${p.key}`;
    const lifecycle = accepted.has(p.key) ? "accepted" : "proposed";
    const linked = items.filter((d) => d.capabilities?.some((c) => c.id === id)).map((d) => d.work);
    return {
      id, key: p.key, area: p.area, name: p.name, purpose: p.purpose, lifecycle, importance: p.importance, paths: p.paths, tests: p.tests,
      requirements: p.key === "catalog.search" ? [{ text: "A brand name lists that brand's products first", acceptance: "a test searches a real brand" }] : [],
      version: 1, source: "survey", confidence: p.confidence, evidence: { ...p.evidence, tests: p.tests },
      reviewedBy: lifecycle === "accepted" ? OWNER : null, reviewedAt: lifecycle === "accepted" ? now : null,
      condition: capabilityCondition({ lifecycle, tests: p.tests.length }, latestSuite, now),
      progress: capabilityProgress(linked.map((w) => ({ number: w.number, title: w.title, stage: w.stage }))),
    };
  });
  return { capabilities: caps, scorecard: scorecard(caps), journeys: journeysFor("commerce", caps), surveyedAt: now };
}

/** Boarding in the demo: most of the way through, with the interventions a real board-in logs. */
export function boardingSample(now: string): Boarding & { interview: null } {
  const b = boardingProgress(
    {
      scanned: true, repo: true, repoPath: true, items: { C1: "done", C2: "done", C4: "done", I5: "done" }, censusAt: now,
      capabilities: { proposed: 4, accepted: 4 }, domain: true, interviewAt: now, crewVersion: 1, baselineTests: 41, released: 1, agreementSigned: false,
    },
    [
      { at: t(-41), step: "connect", note: "The voice database login had to be created by hand in MongoDB Atlas.", by: "Strategic Machines" },
      { at: t(-39.2), step: "survey", note: "Renamed the proposed 'Owner tools' capability to 'Saved voice calls'.", by: OWNER },
    ],
  );
  return { ...b, interview: null };
}
