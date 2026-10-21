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
 * #3 mirrors the real Work item #9 on Machine Shop (released 2026-10-21): the
 * same design, four steps, commits and test counts (243 → 276), no repairs.
 * It is told in stages, so a recording can show the whole cycle:
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
    proof: { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 240, failed: 0, total: 240 }, baseline: 238, pushed: true, previewState: "success", branch: "work/1", commit: "2fa8d610", previewUrl: null, previewStatus: null, at: t(-70) },
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
      msg("s1-m4", "model", "Release", "learn", "Live. Production deployed and the site answers 200. 240/240 tests passing.", -69),
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
    proof: { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 243, failed: 0, total: 243 }, baseline: 240, pushed: true, previewState: "success", branch: "work/2", commit: "9b2c41e0", previewUrl: null, previewStatus: null, at: t(-40) },
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
      msg("s2-m5", "model", "Release", "learn", "Live. Brand searches list that brand first. 243/243 tests passing.", -39),
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
const CHECKOUT_DESIGN = `# Buy now with Stripe (test mode)

## Outcome
A shopper opens a product, selects "Buy now" and pays on Stripe's checkout page with a test card. Stripe records the order and the shipping address. Sally sees each order in the Stripe test dashboard and ships it from there.

## What the shopper sees
1. The product page shows a "Buy now" button next to "Ask about this product".
2. The button shows only when the product has a price, is in stock and is priced in US dollars.
3. Stripe's page asks for the shipping address and card, and shows the flat shipping charge.
4. After payment, an "Order received" page shows the product, the total and the Stripe order reference.
5. If the shopper cancels, Stripe sends them back to the product page.

## Decisions
1. One product per order, quantity 1. No cart.
2. US shipping addresses only, one flat rate: $9.95.
3. Stripe holds the orders. The site keeps no orders database and stores no addresses.

## Safety rules
- The server reads the price from the catalog. It never accepts a price from the browser.
- The site uses a Stripe test key only. The server refuses to create a checkout with a live key.
- Card details go only to Stripe. The "Order received" page shows no address.
- The catalog stays read-only.

## How we'll prove it
1. A test-card payment for a priced product creates a paid order with a US address.
2. The order total equals the catalog price plus the flat shipping rate.
3. Products with no price, out of stock or not in US dollars show no "Buy now" button.
4. A changed price or product ID sent from the browser cannot change the charged amount.
5. A live Stripe key makes the server refuse checkout.
6. Typecheck, the full test suite and the build pass.

## Out of scope
Cart, sales tax, stock reduction, refunds, order emails and live payments: each can start later as its own improvement.`;

const CHECKOUT_STEPS = [
  { title: "Add the checkout rules", detail: "Who can buy, the amount in cents, US-only shipping, the $9.95 flat rate and the test-key check; a unit test for each rule.", files: ["lib/checkout.ts", "lib/checkout.test.ts"], commit: "16cb20fe", tests: 252 },
  { title: "Add the Stripe client and the checkout route", detail: "The route looks the product up in the catalog and opens Stripe Checkout; route tests with Stripe mocked.", files: ["lib/stripe.ts", "lib/stripe.test.ts", "app/api/checkout/route.ts", "app/api/checkout/route.test.ts"], commit: "c0bcacd1", tests: 269 },
  { title: "Add the Buy now button, the Order received page and the cancel return", detail: "The button shows only when a product can be bought; tests cover when it shows.", files: ["components/buy-button.tsx", "app/order/success/page.tsx"], commit: "3b35417e", tests: 274 },
  { title: "Update the store notice, .env.example and CLAUDE.md", detail: "\"Browse and ask\" becomes \"Test store: payments use Stripe test mode\"; the site's rules allow test-mode orders.", files: [".env.example", "CLAUDE.md", "app/layout.tsx"], commit: "c9c6e39d", tests: 276 },
];

function itemCheckout(): WorkDetail {
  const stage = demoStage();
  const proven = reached("try");
  const live = reached("live");
  const stepStatus = (i: number): "todo" | "running" | "done" =>
    !reached("build") ? "todo" : reached("try") ? "done" : i < 2 ? "done" : i === 2 ? "running" : "todo";
  const work = base({
    id: "sample-checkout", number: 3, title: "Let shoppers buy and ship a product with Stripe", risk: ["money"], complexity: "high",
    stage: stage === "live" ? "learn" : stage,
    complexityReason: "Money moves and shoppers give an address: Sally approves the design, the plan, the preview and the release.",
    planApproved: reached("build"), tryApproved: live, released: live, branch: "work/3",
    proof: proven ? { ok: true, reasons: [], typecheck: true, build: true, tests: { passed: 276, failed: 0, total: 276 }, baseline: 243, pushed: true, previewState: "success", branch: "work/3", commit: "8d22b2a0", previewUrl: null, previewStatus: null, at: t(18) } : null,
    release: live ? { ok: true, reasons: [], stageCommit: "a3bf9c1d", mainCommit: "a3bf9c1d", productionState: "success", liveUrl: "https://machineshop.example", liveStatus: 200, at: t(21) } : null,
    createdAt: t(0), updatedAt: t(live ? 21 : proven ? 18 : reached("build") ? 13 : reached("plan") ? 8 : reached("design") ? 2.2 : 0.3),
  });

  const messages = [
    msg("s3-m1", "person", `${OWNER} (by voice)`, "discuss", "Let shoppers pick a product, pay with Stripe and have it shipped to them. Stripe test mode only.", 0),
    msg("s3-m2", "model", "Team Lead", "discuss", "Good next step. Money moves and shoppers give an address, so I rate it High: you approve the design, the plan, the preview and the release, and nothing else needs you. Stripe Checkout keeps card details off your site. The Designer drafts it now.", 0.3),
    ...(reached("design") ? [msg("s3-m3", "model", "Designer", "design", "The design is ready: a Buy now button, Stripe Checkout in test mode, the price always from the catalog, US shipping at a flat $9.95, and Stripe keeps the orders.", 2.2)] : []),
    ...(reached("plan")
      ? [
          msg("s3-m4", "person", OWNER, "design", "approve the design", 4),
          msg("s3-m5", "model", "Planner", "plan", "The plan has 4 steps, each with its own tests. Approve it and the crew builds.", 8),
        ]
      : []),
    ...(reached("build")
      ? [
          msg("s3-m6", "person", OWNER, "plan", "approve the plan", 9),
          msg("s3-m7", "model", "Builder", "build", "Step 1 built and checked: the checkout rules (who can buy, the amount in cents, US-only shipping, the flat rate, the test-key check). 252/252 tests passing.", 11),
          msg("s3-m8", "model", "Builder", "build", "Step 2 built and checked: the checkout route reads the price from the catalog and opens Stripe Checkout. 269/269 tests passing.", 13),
        ]
      : []),
    ...(proven
      ? [
          msg("s3-m9", "model", "Builder", "build", "Step 3 built and checked: the Buy now button, the Order received page and the cancel return. 274/274 tests passing.", 15),
          msg("s3-m10", "model", "Builder", "build", "Step 4 built and checked: the store notice now says payments use Stripe test mode. 276/276 tests passing.", 16),
          msg("s3-m11", "model", "Judge", "prove", "Proven: typecheck clean, 276/276 tests passing (the site's baseline was 243), production build ok. The preview is up. Buy something with Stripe's test card 4242 4242 4242 4242, then approve it for release.", 18),
        ]
      : []),
    ...(live
      ? [
          msg("s3-m12", "person", OWNER, "try", "I bought the cordless drill with the test card: $136.63 plus $9.95 shipping, and the order is in Stripe. Approved for release.", 20),
          msg("s3-m13", "model", "Release", "learn", "Live. Production deployed and the site answers 200. Shoppers can buy now. The record is in docs/accelerator/work-3.md.", 21),
        ]
      : []),
  ];

  const jobs: Job[] = [
    ...(live ? [job("s3-release", "release", "build", 20.5)] : []),
    ...(proven ? [job("s3-prove", "prove", "judge", 17), job("s3-build4", "build_step", "build", 15.5), job("s3-build3", "build_step", "build", 14)] : []),
    ...(stage === "build" ? [job("s3-build3", "build_step", "build", 14, "running")] : []),
    ...(reached("build") ? [job("s3-build2", "build_step", "build", 12), job("s3-build1", "build_step", "build", 10)] : []),
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
            attempts: stepStatus(i) === "done" ? 1 : 0,
            evidence: stepStatus(i) === "done" ? { summary: s.detail, files: s.files, commit: s.commit } : {},
          }))
        : [],
      mandate: reached("plan")
        ? {
            version: 1, createdBy: OWNER, createdAt: t(4.5),
            outcome: "Shoppers can buy one product and have it shipped in the US, paid through Stripe test mode; Stripe keeps the orders.",
            scope: ["Buy now button", "Stripe Checkout", "US shipping at a flat $9.95", "Order received page"],
            outOfScope: ["Cart", "Sales tax", "Refunds", "Order emails", "Live payments"],
            acceptance: ["A test-card payment creates a paid order with a US address", "The total equals the catalog price plus $9.95", "No Buy now without a price, stock and US dollars", "The browser can't change the charged amount", "A live Stripe key is refused"],
            protected: ["The catalog stays read-only", "Card details never touch the site", "The assistant mentions only products the catalog returns"],
            budgetUsd: 40, dueBy: null, decisionOwners: "Sally approves the design, the plan, the preview and the release.", reviewBy: null,
          }
        : null,
      budget: { limit: reached("plan") ? 40 : null, spent: live ? 18.4 : proven ? 17.1 : reached("build") ? 9.6 : reached("plan") ? 2.4 : 0.9, over: false, near: false },
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
    c(-72, 1, "Builder", "step_checks", "Step built and checked: responsive image sizes (240/240 tests).", true),
    c(-70.5, 1, "Judge", "prove", "Proven: every check passed and the preview is up (2fa8d610).", true),
    pol(-70, 1, "#1 shipped under the Low-complexity policy: every check passed."),
    c(-69, 1, "Release", "release", "Live: https://machineshop.example answers 200.", true),
    c(-49.8, 2, "Team Lead", "assessed", "Rated Medium complexity: changes how search reads the catalog."),
    c(-49, 2, "Designer", "drafted", "Brief v1 drafted for #2."),
    p(-48, 2, "decision", "Approved the Brief v1 (typed in the conversation)."),
    c(-44, 2, "Builder", "step_checks", "Step built and checked: brand matching and ranking (243/243 tests).", true),
    c(-40.5, 2, "Judge", "prove", "Proven: every check passed and the preview is up (9b2c41e0).", true),
    p(-40, 2, "decision", "Ship it: released #2 (9b2c41e0)."),
    c(-39, 2, "Release", "release", "Live: brand searches list that brand first.", true),
  ];
  const story: [DemoStage, Entry][] = [
    ["discuss", c(0.3, 3, "Team Lead", "assessed", "Rated High complexity: money moves and shoppers give an address.")],
    ["discuss", c(0.4, 3, "Team Lead", "handoff", "Team Lead → Designer: write the design.")],
    ["design", c(2.2, 3, "Designer", "drafted", "Design v1 drafted for #3.")],
    ["plan", p(4, 3, "decision", "Approved design v1.")],
    ["plan", p(4.5, 3, "decision", "Mandate v1 set for #3: outcome, 5 acceptance criteria, protected behavior, $40 budget.")],
    ["plan", c(8, 3, "Planner", "drafted", "Plan of 4 steps drafted for #3.")],
    ["build", p(9, 3, "decision", "Approved the plan (4 steps).")],
    ["build", c(9.2, 3, "Planner", "handoff", "Planner → Builder: build the next step under mandate v1.")],
    ["build", c(11, 3, "Builder", "step_checks", "Step 1 built and checked: the checkout rules (252/252 tests).", true)],
    ["build", c(13, 3, "Builder", "step_checks", "Step 2 built and checked: the Stripe client and the checkout route (269/269 tests).", true)],
    ["try", c(15, 3, "Builder", "step_checks", "Step 3 built and checked: Buy now, Order received and the cancel return (274/274 tests).", true)],
    ["try", c(16, 3, "Builder", "step_checks", "Step 4 built and checked: the store notice, .env.example and the site's rules (276/276 tests).", true)],
    ["try", c(16.5, 3, "Librarian", "note", "Record written to docs/accelerator/work-3.md on work/3.")],
    ["try", c(16.8, 3, "Builder", "handoff", "Builder → Judge: prove the candidate.")],
    ["try", c(18, 3, "Judge", "prove", "Proven: every check passed and the preview is up (8d22b2a0).", true)],
    ["live", p(20, 3, "decision", "Approved the preview for release (8d22b2a0), after a test purchase.")],
    ["live", c(21, 3, "Release", "release", "Live: shoppers can buy now. https://machineshop.example answers 200.", true)],
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
    e("step_checks", true, "2fa8d610", 240, 0, -72, 1, "s1-st1"),
    e("prove", true, "2fa8d610", 240, 0, -70.5, 1, null),
    e("release", true, "2fa8d610", null, null, -69, 1, null),
    e("step_checks", true, "9b2c41e0", 243, 0, -44, 2, "s2-st1"),
    e("prove", true, "9b2c41e0", 243, 0, -40.5, 2, null),
    e("release", true, "9b2c41e0", null, null, -39, 2, null),
    ...(reached("build") ? [e("step_checks", true, "16cb20fe", 252, 0, 11, 3, "s3-st1"), e("step_checks", true, "c0bcacd1", 269, 0, 13, 3, "s3-st2")] : []),
    ...(reached("try")
      ? [
          e("step_checks", true, "3b35417e", 274, 0, 15, 3, "s3-st3"),
          e("step_checks", true, "c9c6e39d", 276, 0, 16, 3, "s3-st4"),
          e("prove", true, "8d22b2a0", 276, 0, 18, 3, null),
          e("census", true, "8d22b2a0", null, null, 18, 3, null, {
            files: 57, lines: 6209, functions: 184, components: 22, routes: 13, tests: 16,
            hotspots: [{ path: "components/voice-call.tsx", branches: 91, lines: 546 }, { path: "lib/voice.ts", branches: 75, lines: 458 }, { path: "components/assistant.tsx", branches: 43, lines: 301 }],
          }),
        ]
      : []),
    ...(reached("live") ? [e("release", true, "a3bf9c1d", null, null, 21, 3, null)] : []),
  ];
}

/** The hour the story has reached; it is "now" in the readings. */
const storyNow = () => ({ discuss: 0.5, design: 2.5, plan: 8.5, build: 13.5, try: 18.5, live: 21.5 })[demoStage()];

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
    baselineTests: 243,
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
  ...(reached("build") ? ["lib/checkout.ts", "lib/checkout.test.ts", "lib/stripe.ts", "lib/stripe.test.ts", "app/api/checkout/route.ts", "app/api/checkout/route.test.ts"] : []),
  ...(reached("try") ? ["components/buy-button.tsx", "app/order/success/page.tsx"] : []),
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
      requirements: p.key === "sales.checkout" ? [{ text: "The total equals the catalog price plus the flat shipping rate", acceptance: "a unit test per rule" }, { text: "The browser can't change the charged amount", acceptance: "a route test" }] : [],
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
      capabilities: { proposed: 4, accepted: 4 }, domain: true, interviewAt: now, crewVersion: 1, baselineTests: 238, released: 2, agreementSigned: false,
    },
    [
      { at: t(-91), step: "connect", note: "The voice database login had to be created by hand in MongoDB Atlas.", by: "Strategic Machines" },
      { at: t(-89.2), step: "survey", note: "Renamed the proposed 'Owner tools' capability to 'Saved voice calls'.", by: OWNER },
    ],
  );
  return { ...b, interview: null };
}
