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
 * The keyless demo's story (G2.4): Example Machine Shop, an online home-and-
 * hardware shop. Sally owns it: a business owner who sells on the web and
 * doesn't code. She has grown the site one step at a time with the crew:
 *   #1 Low:    blurry product images on phones. Fixed, proven and shipped by the crew.
 *   #2 Medium: search by brand. Sally approved a short Brief and shipped it.
 *   #3 High:   let shoppers buy and ship a product with Stripe. Money moves, so
 *              Sally approves the design, the plan, the preview and the release.
 *
 * #3 is told in stages, so a recording can show the whole cycle:
 *   discuss → design → plan → build → try → live
 * ACCELERATOR_DEMO_STAGE picks the stage (default "try": proven, waiting on
 * Sally's release decision). Synthetic and read-only: never persisted, never
 * shown as a real site's evidence.
 */

export const DEMO_STAGES = ["discuss", "design", "plan", "build", "try", "live"] as const;
export type DemoStage = (typeof DEMO_STAGES)[number];
export const demoStage = (): DemoStage => {
  const v = process.env.ACCELERATOR_DEMO_STAGE;
  return (DEMO_STAGES as readonly string[]).includes(v ?? "") ? (v as DemoStage) : "try";
};
const reached = (s: DemoStage) => DEMO_STAGES.indexOf(demoStage()) >= DEMO_STAGES.indexOf(s);

const DAY = Date.UTC(2026, 9, 15, 9, 0);
const t = (hours: number) => new Date(DAY + hours * 3_600_000).toISOString();
const models = resolveModels(DEFAULT_MODELS);
const OWNER = "Sally (Owner)";

const base = (w: Partial<WorkItem> & Pick<WorkItem, "id" | "number" | "title" | "stage" | "complexity">): WorkItem => ({
  kind: "change", risk: [], recommendedComplexity: w.complexity, complexityReason: null, complexitySetBy: "platform", ready: true, autoShip: false,
  paused: false, proofRepairs: 0, branch: `work/${w.number}`, planApproved: false, previewUrl: null, proof: null, tryApproved: false, released: false,
  release: null, createdAt: t(0), updatedAt: t(1), ...w,
});

type Job = WorkDetail["jobs"][number];
const job = (id: string, kind: Job["kind"], role: keyof typeof models, at: number, status: Job["status"] = "done"): Job => ({
  id, kind, status, provider: models[role].provider, model: models[role].model, error: null, createdAt: t(at), startedAt: t(at), finishedAt: status === "done" ? t(at + 0.2) : null,
});

const msg = (id: string, who: "person" | "model" | "system", label: string, stage: string, body: string, at: number) => ({
  id, authorKind: who, authorLabel: label, model: who === "model" ? models.consult.model : null, stage, body, createdAt: t(at),
});

/** Finishes a detail: actions and the pending decision come from the same domain rules as a real item. */
function detail(d: Omit<WorkDetail, "actions" | "crewNext" | "decision" | "models" | "runnerOnline" | "events">, jobRunning = false): WorkDetail {
  const w = d.work;
  const latest = d.designs.at(-1);
  const actions = workActions({
    stage: w.stage, risk: w.risk, complexity: w.complexity, ready: w.ready, autoShip: w.autoShip, paused: w.paused, proofRepairs: w.proofRepairs,
    jobRunning, latestDesign: latest ? { version: latest.version, approved: !!latest.approvedAt } : null, planApproved: w.planApproved,
    steps: d.steps, proven: w.proof?.ok === true, proofFailed: !!w.proof && !w.proof.ok, tryApproved: w.tryApproved, released: w.released,
  });
  const decision = pendingDecision({ complexity: w.complexity, risk: w.risk, latestDesignVersion: latest?.version ?? null, candidate: w.proof?.commit ?? null, actions });
  return { ...d, actions, crewNext: null, decision, models, runnerOnline: true, events: [] };
}

// ── #1 and #2: the steps Sally has already taken ────────────────────────────
function itemImages(): WorkDetail {
  const work = base({
    id: "sample-images", number: 1, title: "Fix blurry product images on phones", stage: "done", complexity: "low",
    complexityReason: "Display only: no data, money or sign-in.", planApproved: true, tryApproved: true, released: true,
    proof: { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 36, failed: 0, total: 36 }, baseline: 34, pushed: true, previewState: "success", branch: "work/1", commit: "2fa8d610", previewUrl: null, previewStatus: null, at: t(-70) },
    release: { ok: true, reasons: [], stageCommit: "2fa8d610", mainCommit: "2fa8d610", productionState: "success", liveUrl: "https://machineshop.example", liveStatus: 200, at: t(-69) },
    createdAt: t(-74), updatedAt: t(-69),
  });
  return detail({
    work,
    jobs: [job("s1-release", "release", "build", -69.5), job("s1-prove", "prove", "judge", -70.5), job("s1-build", "build_step", "build", -72)],
    messages: [
      msg("s1-m1", "person", OWNER, "discuss", "Product photos look blurry on my phone.", -74),
      msg("s1-m2", "model", "Team Lead", "discuss", "Low complexity: display only. I'll fix it, prove it and ship it. You'll see it live.", -73.8),
      msg("s1-m3", "system", "Crew", "release", "Low complexity: every check in the TDD plane passed, so this ships now.", -70),
      msg("s1-m4", "model", "Release", "learn", "Live. Production deployed and the site answers 200. 36/36 tests passing.", -69),
    ],
    designs: [],
    steps: [{ id: "s1-st1", position: 1, title: "Fix blurry product images on phones", detail: "Serve images at the phone's pixel density; add a test.", status: "done", attempts: 1, evidence: { summary: "Responsive image sizes; test added.", files: ["components/product-card.tsx", "lib/product.test.ts"], commit: "2fa8d610" } }],
    mandate: null,
    budget: { limit: null, spent: 1.9, over: false, near: false },
    capabilities: [{ id: "cap-browse", name: "Browse the catalog", area: "Catalog" }],
  });
}

function itemBrand(): WorkDetail {
  const work = base({
    id: "sample-brand", number: 2, title: "Search by brand", stage: "done", complexity: "medium",
    complexityReason: "Changes how search reads the catalog; no money or personal data.", planApproved: true, tryApproved: true, released: true,
    proof: { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 41, failed: 0, total: 41 }, baseline: 36, pushed: true, previewState: "success", branch: "work/2", commit: "9b2c41e0", previewUrl: null, previewStatus: null, at: t(-40) },
    release: { ok: true, reasons: [], stageCommit: "9b2c41e0", mainCommit: "9b2c41e0", productionState: "success", liveUrl: "https://machineshop.example", liveStatus: 200, at: t(-39) },
    createdAt: t(-50), updatedAt: t(-39),
  });
  return detail({
    work,
    jobs: [job("s2-release", "release", "build", -39.5), job("s2-prove", "prove", "judge", -40.5), job("s2-build", "build_step", "build", -44), job("s2-brief", "design", "design", -49)],
    messages: [
      msg("s2-m1", "person", OWNER, "discuss", "Shoppers type a brand name and get mixed results. Can search find brands?", -50),
      msg("s2-m2", "model", "Team Lead", "discuss", "Medium: it changes how search reads the catalog. The Designer writes a short Brief; you approve it once, and the crew plans, builds and proves on its own.", -49.8),
      msg("s2-m3", "person", OWNER, "design", "approve the brief", -48),
      msg("s2-m4", "person", OWNER, "try", "ship it", -40),
      msg("s2-m5", "model", "Release", "learn", "Live. Brand searches list that brand first. 41/41 tests passing.", -39),
    ],
    designs: [{
      id: "s2-d1", version: 1, authorLabel: "Designer", model: models.design.model, createdAt: t(-49), approvedAt: t(-48),
      body: "# Search by brand\n\n## Summary\nA brand name in the search box lists that brand's products first.\n\n## What changes\n- Search matches the brand field as well as the name\n\n## What stays protected\n- The catalog stays read-only\n- Every list stays paginated\n\n## How we'll prove it\n- A test searches a real brand and gets only its products first",
    }],
    steps: [{ id: "s2-st1", position: 1, title: "Match and rank by brand", detail: "Search the brand field; brand matches first; tests.", status: "done", attempts: 1, evidence: { summary: "Brand matching and ranking; tests added.", files: ["lib/catalog.ts", "lib/catalog.test.ts"], commit: "9b2c41e0" } }],
    mandate: null,
    budget: { limit: null, spent: 3.2, over: false, near: false },
    capabilities: [{ id: "cap-search", name: "Search", area: "Catalog" }],
  });
}

// ── #3: buy and ship with Stripe, told in stages ────────────────────────────
const CHECKOUT_DESIGN = `# Buy and ship with Stripe

## Goal
A shopper picks a product, pays with Stripe and has it shipped. Sally sees each order in Stripe.

## What we agreed
1. A "Buy and ship" button on every product page with a price and stock.
2. Payment through Stripe Checkout: card details never touch our site.
3. The price always comes from the catalog on the server, never from the browser.
4. Checkout collects the shipping address; one flat shipping rate to start.
5. Test mode only until Sally approves the release.

## Scope / Out of scope
In: one product per order, shipping address, flat-rate shipping, an order confirmation page.
Out: a cart with several products, discounts, accounts, refunds (later steps).

## Data
The catalog stays read-only. Orders live in Stripe. No card data is stored by the site.

## How we'll prove it
- Price: the charge equals the catalog price, even if the browser sends another.
- Stock: an out-of-stock product can't be bought.
- Tax and shipping: the total is price + shipping + tax, to the cent.
- A declined card shows a clear message and creates no order.
- A double click creates one payment, not two.
- The payment confirmation from Stripe is checked for its signature.

## Risks and open questions
Money moves: Sally approves the design, the plan, the preview and the release.`;

const CHECKOUT_STEPS = [
  { title: "Add the Buy and ship button and Stripe Checkout (test mode)", detail: "Button on the product page; a server route opens Stripe Checkout; tests.", files: ["app/p/[id]/buy-button.tsx", "app/api/checkout/route.ts", "app/api/checkout/route.test.ts"], commit: "4d1e7a30" },
  { title: "Charge the catalog price, never the browser's", detail: "The server reads price and stock from the catalog; tests for tampering and out of stock.", files: ["lib/checkout.ts", "lib/checkout.test.ts"], commit: "8c03b9f2" },
  { title: "Collect the shipping address and confirm the order", detail: "Shipping address and flat rate in Checkout; a confirmation page; a signed webhook; tests for declined cards and double clicks.", files: ["app/order/[session]/page.tsx", "app/api/stripe/webhook/route.ts", "app/api/stripe/webhook/route.test.ts"], commit: "c7f5e118" },
];

function itemCheckout(): WorkDetail {
  const stage = demoStage();
  const proven = reached("try");
  const live = reached("live");
  const stepStatus = (i: number): "todo" | "running" | "done" =>
    !reached("build") ? "todo" : reached("try") ? "done" : i === 0 ? "done" : i === 1 ? "running" : "todo";
  const work = base({
    id: "sample-checkout", number: 3, title: "Let shoppers buy and ship a product with Stripe", risk: ["money"], complexity: "high",
    stage: stage === "live" ? "learn" : stage,
    complexityReason: "Money moves: payments, prices, tax and shipping. Sally approves each stop.",
    planApproved: reached("build"), tryApproved: live, released: live, branch: "work/3",
    proof: proven ? { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 58, failed: 0, total: 58 }, baseline: 41, pushed: true, previewState: "success", branch: "work/3", commit: "c7f5e118", previewUrl: null, previewStatus: null, at: t(30) } : null,
    release: live ? { ok: true, reasons: [], stageCommit: "c7f5e118", mainCommit: "c7f5e118", productionState: "success", liveUrl: "https://machineshop.example", liveStatus: 200, at: t(34) } : null,
    createdAt: t(0), updatedAt: t(live ? 34 : proven ? 30 : reached("build") ? 17 : reached("plan") ? 8 : reached("design") ? 2.2 : 0.3),
  });

  const messages = [
    msg("s3-m1", "person", `${OWNER} (by voice)`, "discuss", "I want shoppers to pick a product, pay with Stripe and have it shipped to them.", 0),
    msg("s3-m2", "model", "Team Lead", "discuss", "Good next step. Money moves here, so I rate it High: you approve the design, the plan, the preview and the release, and nothing else needs you. Stripe Checkout keeps card details off your site. The Designer drafts it now.", 0.3),
    ...(reached("design") ? [msg("s3-m3", "model", "Designer", "design", "Design v1 is ready: a Buy and ship button, Stripe Checkout in test mode, the price always from the catalog, the shipping address and one flat shipping rate.", 2.2)] : []),
    ...(reached("plan")
      ? [
          msg("s3-m4", "person", OWNER, "design", "approve the design", 4),
          msg("s3-m5", "model", "Planner", "plan", "The plan has 3 steps, each with its own tests. Approve it and the crew builds.", 8),
        ]
      : []),
    ...(reached("build")
      ? [
          msg("s3-m6", "person", OWNER, "plan", "approve the plan", 9),
          msg("s3-m7", "model", "Builder", "build", "Step 1 built and checked: the Buy and ship button opens Stripe Checkout in test mode. 47/47 tests passing.", 14),
          msg("s3-m8", "system", "Crew", "build", "Step 2 didn't pass its checks: 1 test failing (a tampered price was accepted). The crew is fixing it (repair 1 of 2).", 17),
        ]
      : []),
    ...(proven
      ? [
          msg("s3-m9", "model", "Builder", "build", "Step 2 repaired: the server now charges the catalog price whatever the browser sends. 53/53 tests passing.", 19),
          msg("s3-m10", "model", "Builder", "build", "Step 3 built and checked: shipping address, flat-rate shipping, the confirmation page and a signed Stripe webhook. 58/58 tests passing.", 26),
          msg("s3-m11", "model", "Judge", "prove", "Proven: typecheck clean, 58/58 tests passing (the site's baseline was 41), production build ok. The preview is up. Buy something with Stripe's test card 4242 4242 4242 4242, then approve it for release.", 30),
        ]
      : []),
    ...(live
      ? [
          msg("s3-m12", "person", OWNER, "try", "I bought the drill with the test card and the order showed up in Stripe. Approved for release.", 33),
          msg("s3-m13", "model", "Release", "learn", "Live. Production deployed and the site answers 200. Shoppers can buy and ship. The record is in docs/accelerator/work-3.md.", 34),
        ]
      : []),
  ];

  const jobs: Job[] = [
    ...(live ? [job("s3-release", "release", "build", 33.5)] : []),
    ...(proven ? [job("s3-prove", "prove", "judge", 29), job("s3-build3", "build_step", "build", 24), job("s3-build2b", "build_step", "build", 18)] : []),
    ...(stage === "build" ? [job("s3-build2b", "build_step", "build", 18, "running")] : []),
    ...(reached("build") ? [job("s3-build2", "build_step", "build", 16), job("s3-build1", "build_step", "build", 12)] : []),
    ...(reached("plan") ? [job("s3-plan", "plan", "plan", 6)] : []),
    ...(reached("design") ? [job("s3-design", "design", "design", 1)] : [job("s3-design", "design", "design", 1, "running")]),
    job("s3-lead", "discuss", "consult", 0.1),
  ];

  return detail(
    {
      work,
      jobs,
      messages,
      designs: reached("design") ? [{ id: "s3-d1", version: 1, authorLabel: "Designer", model: models.design.model, createdAt: t(2.2), approvedAt: reached("plan") ? t(4) : null, body: CHECKOUT_DESIGN }] : [],
      steps: reached("plan")
        ? CHECKOUT_STEPS.map((s, i) => ({
            id: `s3-st${i + 1}`, position: i + 1, title: s.title, detail: s.detail, status: stepStatus(i),
            attempts: i === 1 && reached("build") ? 2 : stepStatus(i) === "done" ? 1 : 0,
            evidence: stepStatus(i) === "done" ? { summary: s.detail, files: s.files, commit: s.commit } : {},
          }))
        : [],
      mandate: reached("plan")
        ? {
            version: 1, createdBy: OWNER, createdAt: t(4.5),
            outcome: "Shoppers can buy one product and have it shipped, paid through Stripe; nothing is charged while testing.",
            scope: ["Buy and ship button", "Stripe Checkout", "Shipping address and flat-rate shipping", "Order confirmation"],
            outOfScope: ["A cart with several products", "Discounts", "Refunds"],
            acceptance: ["The charge equals the catalog price", "An out-of-stock product can't be bought", "A declined card creates no order", "A double click creates one payment", "Stripe's confirmation is signature-checked"],
            protected: ["The catalog stays read-only", "Card details never touch the site", "The assistant mentions only products the catalog returns"],
            budgetUsd: 40, dueBy: null, decisionOwners: "Sally approves the design, the plan, the preview and the release.", reviewBy: null,
          }
        : null,
      budget: { limit: reached("plan") ? 40 : null, spent: live ? 24.6 : proven ? 22.9 : reached("build") ? 14.2 : reached("plan") ? 3.1 : 1.2, over: false, near: false },
      capabilities: reached("build") ? [{ id: "cap-checkout", name: "Checkout and payment", area: "Sales" }, { id: "cap-product", name: "Product page", area: "Catalog" }] : [],
    },
    stage === "discuss" || stage === "build",
  );
}

/** Every sample Work item, newest first. */
export const sampleItems = (): WorkDetail[] => [itemCheckout(), itemBrand(), itemImages()];

/** One sample Work item by number (3 is the Stripe checkout told in stages). */
export function studioSample(number = 3): WorkDetail {
  const found = sampleItems().find((d) => d.work.number === number);
  if (!found) throw new Error(`No sample item #${number}.`);
  return found;
}

/** The sample's ledger, gated by the demo stage: what a real site's Change Ledger records, in order. */
function sampleLedger(): (Omit<TimelineEntry, "id" | "refs" | "work"> & { work: number | null })[] {
  const p = (at: number, work: number | null, kind: string, summary: string, counts = true) => ({ at: t(at), kind, actorKind: "person" as const, actor: OWNER, counts, work, summary });
  const c = (at: number, work: number | null, actor: string, kind: string, summary: string, counts = false) => ({ at: t(at), kind, actorKind: "crew" as const, actor, counts, work, summary });
  const pol = (at: number, work: number, summary: string) => ({ at: t(at), kind: "decision", actorKind: "policy" as const, actor: "Low-complexity policy", counts: true, work, summary });
  type Entry = ReturnType<typeof p> | ReturnType<typeof c> | ReturnType<typeof pol>;
  const history: Entry[] = [
    p(-90, null, "interview", "Site interview v1 saved: sell home and hardware products online; never break search or the catalog."),
    c(-89.5, null, "Surveyor", "survey", "Capability survey: 8 proposed from 52 files (commerce)."),
    p(-89, null, "capability", "Catalog, Search, Product page and Product sheets accepted into the inventory."),
    p(-88.5, null, "crew", "Crew v1 saved with the Commerce domain pack."),
    c(-73.8, 1, "Team Lead", "assessed", "Rated Low complexity: display only."),
    c(-73.7, 1, "Team Lead", "handoff", "Team Lead → Builder: build the next step."),
    c(-72, 1, "Builder", "step_checks", "Step built and checked: responsive image sizes (36/36 tests).", true),
    c(-70.5, 1, "Judge", "prove", "Proven: every check passed and the preview is up (2fa8d610).", true),
    pol(-70, 1, "#1 shipped under the Low-complexity policy: every check passed."),
    c(-69, 1, "Release", "release", "Live: https://machineshop.example answers 200.", true),
    c(-49.8, 2, "Team Lead", "assessed", "Rated Medium complexity: changes how search reads the catalog."),
    c(-49, 2, "Designer", "drafted", "Brief v1 drafted for #2."),
    p(-48, 2, "decision", "Approved the Brief v1 (typed in the conversation)."),
    c(-44, 2, "Builder", "step_checks", "Step built and checked: brand matching and ranking (41/41 tests).", true),
    c(-40.5, 2, "Judge", "prove", "Proven: every check passed and the preview is up (9b2c41e0).", true),
    p(-40, 2, "decision", "Ship it: released #2 (9b2c41e0)."),
    c(-39, 2, "Release", "release", "Live: brand searches list that brand first.", true),
  ];
  const story: [DemoStage, Entry][] = [
    ["discuss", c(0.3, 3, "Team Lead", "assessed", "Rated High complexity: money moves (payments, prices, tax, shipping).")],
    ["discuss", c(0.4, 3, "Team Lead", "handoff", "Team Lead → Designer: write the design.")],
    ["design", c(2.2, 3, "Designer", "drafted", "Design v1 drafted for #3.")],
    ["plan", p(4, 3, "decision", "Approved design v1 (typed in the conversation).")],
    ["plan", p(4.5, 3, "decision", "Mandate v1 set for #3: outcome, 5 acceptance criteria, protected behavior, $40 budget.")],
    ["plan", c(8, 3, "Planner", "drafted", "Plan of 3 steps drafted for #3.")],
    ["build", p(9, 3, "decision", "Approved the plan (3 steps).")],
    ["build", c(9.2, 3, "Planner", "handoff", "Planner → Builder: build the next step under mandate v1.")],
    ["build", c(14, 3, "Builder", "step_checks", "Step 1 built and checked: Buy and ship opens Stripe Checkout in test mode (47/47 tests).", true)],
    ["build", c(17, 3, "Builder", "step_checks", "Step 2 blocked by the Protocol: 1 test failing (a tampered price was accepted).")],
    ["build", c(17.2, 3, "Builder", "repair", "Repairing step 2 of #3 (repair 1 of 2).")],
    ["try", c(19, 3, "Builder", "step_checks", "Step 2 built and checked: the catalog price is charged, whatever the browser sends (53/53 tests).", true)],
    ["try", c(26, 3, "Builder", "step_checks", "Step 3 built and checked: shipping, confirmation and a signed Stripe webhook (58/58 tests).", true)],
    ["try", c(28, 3, "Librarian", "note", "Record written to docs/accelerator/work-3.md on work/3.")],
    ["try", c(29, 3, "Builder", "handoff", "Builder → Judge: prove the candidate.")],
    ["try", c(30, 3, "Judge", "prove", "Proven: every check passed and the preview is up (c7f5e118).", true)],
    ["live", p(33, 3, "decision", "Approved the preview for release (c7f5e118), after a test purchase.")],
    ["live", c(34, 3, "Release", "release", "Live: shoppers can buy and ship. https://machineshop.example answers 200.", true)],
    ["live", c(35, null, "Skillsmith", "skill", "Proposed \"Test every money rule with a tampered request\": a price-tampering test failed once before it was fixed.")],
  ];
  return [...history, ...story.filter(([s]) => reached(s)).map(([, e]) => e)];
}

/** The Site Timeline in the demo, newest first. */
export function timelineSample(): TimelineResponse {
  const titles = new Map(sampleItems().map((d) => [d.work.number, d.work.title]));
  const entries = sampleLedger()
    .map((e, i): TimelineEntry => ({ ...e, id: i + 1, refs: {}, work: e.work ? { number: e.work, title: titles.get(e.work)! } : null }))
    .reverse();
  return { entries, next: null, filter: "all" };
}

/** Evidence for #1, #2 and #3 up to the demo stage. */
function sampleEvidence(): InstrumentInputs["evidence"] {
  const e = (kind: string, ok: boolean, commit: string, total: number | null, failed: number | null, at: number, work: number, step: string | null, detail: Record<string, unknown> = {}) => ({
    kind, ok, commit, passed: total == null ? null : total - (failed ?? 0), failed, total, at: t(at), work, step, detail,
  });
  return [
    e("step_checks", true, "2fa8d610", 36, 0, -72, 1, "s1-st1"),
    e("prove", true, "2fa8d610", 36, 0, -70.5, 1, null),
    e("release", true, "2fa8d610", null, null, -69, 1, null),
    e("step_checks", true, "9b2c41e0", 41, 0, -44, 2, "s2-st1"),
    e("prove", true, "9b2c41e0", 41, 0, -40.5, 2, null),
    e("release", true, "9b2c41e0", null, null, -39, 2, null),
    ...(reached("build") ? [e("step_checks", true, "4d1e7a30", 47, 0, 14, 3, "s3-st1"), e("step_checks", false, "8c03b9f0", 53, 1, 17, 3, "s3-st2")] : []),
    ...(reached("try")
      ? [
          e("step_checks", true, "8c03b9f2", 53, 0, 19, 3, "s3-st2"),
          e("step_checks", true, "c7f5e118", 58, 0, 26, 3, "s3-st3"),
          e("prove", true, "c7f5e118", 58, 0, 30, 3, null),
          e("census", true, "c7f5e118", null, null, 30, 3, null, {
            files: 58, lines: 6900, functions: 189, components: 23, routes: 15, tests: 17,
            hotspots: [{ path: "lib/checkout.ts", branches: 24, lines: 180 }, { path: "lib/product.ts", branches: 31, lines: 240 }],
          }),
        ]
      : []),
    ...(reached("live") ? [e("release", true, "c7f5e118", null, null, 34, 3, null)] : []),
  ];
}

/** The hour the story has reached; it is "now" in the readings. */
const storyNow = () => ({ discuss: 0.5, design: 2.5, plan: 8.5, build: 17.5, try: 30.5, live: 35.5 })[demoStage()];

/**
 * Synthetic, read-only records for the Cockpit Dial in keyless demo mode.
 * Labelled "sample" by the API; never persisted or used as live evidence.
 */
export function instrumentsSample(now: string): Omit<InstrumentInputs, "scope"> {
  const shift = Date.parse(now) - (DAY + storyNow() * 3_600_000);
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
    evidence: sampleEvidence().map((e) => ({ ...e, at: at(e.at) })),
    ledger: sampleLedger().map((e) => ({ at: at(e.at), kind: e.kind, actorKind: e.actorKind, actorLabel: e.actor, counts: e.counts, work: e.work, summary: e.summary })),
  };
}

/** Machine Shop's repository, as the Surveyor sees it (file names only); checkout files appear once built. */
const sampleFiles = () => [
  "app/page.tsx", "app/layout.tsx", "app/p/[id]/page.tsx", "app/p/[id]/sheet/page.tsx", "app/p/[id]/sheet/print-sheet.tsx",
  "app/api/assistant/route.ts", "app/api/voice/session/route.ts", "app/api/voice/session/route.test.ts", "app/owner/transcripts/page.tsx",
  "components/search-box.tsx", "components/gallery.tsx", "components/product-card.tsx", "components/assistant.tsx", "components/voice-call.tsx",
  "lib/catalog.ts", "lib/catalog.test.ts", "lib/product.ts", "lib/product.test.ts", "lib/assistant-tools.ts", "lib/assistant-tools.test.ts",
  ...(reached("build") ? ["app/p/[id]/buy-button.tsx", "app/api/checkout/route.ts", "app/api/checkout/route.test.ts", "lib/checkout.ts", "lib/checkout.test.ts"] : []),
  ...(reached("try") ? ["app/order/[session]/page.tsx", "app/api/stripe/webhook/route.ts", "app/api/stripe/webhook/route.test.ts"] : []),
];

/** The capability inventory in the demo: the Survey's proposals, the accepted ones with condition and progress. */
export function capabilitiesSample(now: string): CapabilitiesResponse {
  const accepted = new Set(["catalog.browse", "catalog.search", "catalog.product", "catalog.sheets", ...(reached("build") ? ["sales.checkout"] : [])]);
  const ids: Record<string, string> = { "catalog.browse": "cap-browse", "catalog.search": "cap-search", "catalog.product": "cap-product", "sales.checkout": "cap-checkout" };
  const items = sampleItems();
  const latestSuite = { ok: true, at: new Date(Date.parse(now) - 2 * 3_600_000).toISOString(), kind: "prove" };
  const caps: Capability[] = proposeCapabilities(sampleFiles(), "commerce").map((p) => {
    const id = ids[p.key] ?? `cap-${p.key}`;
    const lifecycle = accepted.has(p.key) ? "accepted" : "proposed";
    const linked = items.filter((d) => d.capabilities?.some((c) => c.id === id)).map((d) => d.work);
    return {
      id, key: p.key, area: p.area, name: p.name, purpose: p.purpose, lifecycle, importance: p.importance, paths: p.paths, tests: p.tests,
      requirements: p.key === "sales.checkout" ? [{ text: "The charge equals the catalog price", acceptance: "a tampered-price test" }, { text: "A double click creates one payment", acceptance: "an idempotency test" }] : [],
      version: 1, source: "survey", confidence: p.confidence, evidence: { ...p.evidence, tests: p.tests },
      reviewedBy: lifecycle === "accepted" ? OWNER : null, reviewedAt: lifecycle === "accepted" ? now : null,
      condition: capabilityCondition({ lifecycle, tests: p.tests.length }, latestSuite, now),
      progress: capabilityProgress(linked.map((w) => ({ number: w.number, title: w.title, stage: w.stage }))),
    };
  });
  return { capabilities: caps, scorecard: scorecard(caps), journeys: journeysFor("commerce", caps), surveyedAt: now };
}

/** Boarding in the demo: done long ago except the Agreement, with the interventions a real board-in logs. */
export function boardingSample(now: string): Boarding & { interview: null } {
  const b = boardingProgress(
    {
      scanned: true, repo: true, repoPath: true, items: { C1: "done", C2: "done", C4: "done", I5: "done" }, censusAt: now,
      capabilities: { proposed: 4, accepted: 4 }, domain: true, interviewAt: now, crewVersion: 1, baselineTests: 34, released: 2, agreementSigned: false,
    },
    [
      { at: t(-91), step: "connect", note: "The voice database login had to be created by hand in MongoDB Atlas.", by: "Strategic Machines" },
      { at: t(-89.2), step: "survey", note: "Renamed the proposed 'Owner tools' capability to 'Saved voice calls'.", by: OWNER },
    ],
  );
  return { ...b, interview: null };
}
