import type {
  Account,
  Change,
  Configuration,
  Consultation,
  DataCheck,
  DataInvestigation,
  Doc,
  Drift,
  Fact,
  FileNode,
  Gauges,
  Health,
  Member,
  NeedsYou,
  Org,
  Partner,
  Proof,
  Release,
  Signal,
  Site,
  SiteRequest,
  Skill,
} from "@accelerator/domain";

/**
 * The demo tenant: Example Machine Shop, an illustrative online home-and-
 * hardware shop (gen2-crew.md G2.4). Synthetic data only; it tells the
 * platform's story and is never a real site's evidence.
 */

/** The house partner (migration 0006): the demo account is a direct client of Strategic Machines. */
export const HOUSE_PARTNER: Partner = {
  id: "partner_house",
  slug: "strategic-machines",
  name: "Strategic Machines",
  kind: "house",
  tier: null,
  status: "active",
  brand: { crewName: "Strategic Machines" },
};

export const ORG: Org = { id: "org_example_shop", name: "Example Machine Shop Co.", plan: "operate" };

export const MEMBERS: Member[] = [
  { id: "m_morgan", name: "Morgan", email: "owner@example.com", role: "owner" },
  { id: "m_sam", name: "Sam", email: "operator@example.com", role: "operator" },
  { id: "m_riley", name: "Riley", email: "tester@example.com", role: "tester" },
  { id: "m_jordan", name: "Jordan", email: "viewer@example.com", role: "viewer" },
];

export const SITES: Site[] = [
  {
    id: "demo-shop",
    demo: true,
    orgId: ORG.id,
    slug: "demo-shop",
    name: "Example Machine Shop",
    url: "https://machineshop.example",
    repo: "example/machine-shop",
    stack: "Next.js · MongoDB (read-only catalog) · Claude · Vercel",
    status: "live",
    lastReleaseAt: "2026-10-14T16:00:00Z",
  },
];

export const GAUGES: Gauges = {
  health: 94,
  healthNote: "Healthy. One warning: 4 security headers missing.",
  timeToLiveDays: 1.4,
  timeToLiveNote: "Content changes: 3 hours. Features: 2.5 days. Agency baseline: 11 days.",
  openRequests: 12,
  openNote: "4 Now · 5 Next · 3 Later. Half of today's backlog done in about 9 days.",
  quality: 92,
  qualityNote: "Approved first time. 0 rollbacks this month.",
  spendUsd: 214,
  budgetUsd: 500,
  spendNote: "This month, AI and hosting. $6.10 per change.",
};

export const NEEDS_YOU: NeedsYou[] = [
  { id: "n1", kind: "try", title: "#50 One-line folio for all-inclusive packages", detail: "Preview ready. 4-step checklist, about 3 minutes.", href: "change" },
  { id: "n2", kind: "decide", title: "Waterfall height: 50 ft or 55 ft?", detail: "The site says both, on 4 pages. Your answer updates every page.", options: ["55 ft", "50 ft"] },
  { id: "n3", kind: "approve", title: "#58 July 2027 tax report shows $179 unattributed", detail: "Investigation done (read-only). Fix touches 1 reservation.", href: "data" },
  { id: "n4", kind: "ship", title: "#62 Headlines on social preview images", detail: "Approved by Tanner. Evidence green. 6 images." },
];

export const SIGNALS: Signal[] = [
  { id: "s1", severity: "warn", title: "4 security headers missing on the public site", detail: "CSP, nosniff, clickjacking, referrer. Request #64 drafted for you." },
  { id: "s2", severity: "warn", title: "Mobile speed on /gallery dropped to 59", detail: "Large images since Tuesday's release. Fix is a 1-hour change." },
  { id: "s3", severity: "good", title: "Ledger check passed: every balance matches its folio", detail: "1,376 ledger rows checked at 06:00." },
  { id: "s4", severity: "info", title: "Two guests reported the same issue this week", detail: '"Can\'t find the spa booking button on mobile." Merged into #61.' },
];

const r = (
  number: number,
  title: string,
  detail: string,
  type: SiteRequest["type"],
  risk: SiteRequest["risk"],
  priority: SiteRequest["priority"],
  stage: SiteRequest["stage"],
  source: string,
  extra: Partial<SiteRequest> = {},
): SiteRequest => ({
  id: `req_${number}`,
  number,
  siteId: "cypress-resort",
  title,
  detail,
  type,
  risk,
  priority,
  stage,
  source,
  createdAt: "2026-09-20T10:00:00Z",
  ...extra,
});

export const REQUESTS: SiteRequest[] = [
  r(50, "One-line folio for all-inclusive packages", "Guests paid one price; show them one line.", "feature", ["display"], "now", "try", "Tanner", { changeId: "chg_50" }),
  r(62, "Headlines on social preview images", "From the Fit Scan signal.", "content", ["content"], "now", "ship", "Engine"),
  r(58, "July 2027 tax report shows $179 unattributed", "Possible stray migrated data.", "data", ["data", "money"], "now", "clarify", "Patrick", { note: "Needs approval" }),
  r(5, "$5 Georgia hotel fee on add-on nights", "The flat fee doesn't attach to custom add-on nights.", "bug", ["money"], "now", "prove", "Tanner"),
  r(61, "Spa booking button hard to find on mobile", "2 guest reports, merged.", "design", ["display"], "next", "build", "Guests (2)"),
  r(51, "Badge for included items still to be scheduled", "Staff miss items that need a time.", "feature", ["display"], "next", "build", "Chris"),
  r(63, "Gift a package stay", "Buy as a gift, send to someone else.", "feature", ["money", "code"], "next", "clarify", "Melissa", { note: "2 questions for you" }),
  r(64, "Add the 4 missing security headers", "Drafted from a Signal.", "security", ["security"], "next", "new", "Engine"),
  r(57, "Itemized card charges in Stripe", "Refunds made in Stripe reach the folio.", "feature", ["money"], "now", "watch", "Patrick"),
  r(38, "Appointment times for scheduled services", "Massages and photo sessions have no time slot.", "feature", ["code"], "later", "new", "Tanner"),
];

export const CHANGES: Change[] = [
  {
    id: "chg_50",
    siteId: "cypress-resort",
    requestNumber: 50,
    title: "One-line folio for all-inclusive packages",
    stage: "try",
    risk: ["display"],
    level: "AC2",
    summary: "On an all-inclusive package, the guest's folio and receipt show one all-in line. Staff views and the Tax Ledger stay itemized.",
    conversation: [
      { at: "Mon 9:12", from: "human", author: "Tanner", text: "Guests on the VIP package see every line item. They paid one price. Show them one line." },
      {
        at: "Mon 9:12",
        from: "engine",
        author: "Engine",
        text: "Here's how I read it: on an all-inclusive package, the guest's folio shows a single line with the package price. Staff views and the Tax Ledger keep every itemized line. Two questions:",
        bullets: ["Should taxes be inside the one line, or shown separately?", "Does this apply to the emailed receipt too?"],
      },
      { at: "Mon 9:20", from: "human", author: "Tanner", text: "Taxes inside the one line. And yes, the receipt too." },
      { at: "Mon 9:20", from: "decision", author: "Decision D-31", text: "Package folios show one all-in line to guests, taxes included, on screen and on receipts. Staff keep the itemized view." },
      { at: "Mon 11:47", from: "engine", author: "Engine", text: "Built and checked. This changes only how the folio is displayed. Totals, the ledger and tax reports are unchanged. The preview has a sample VIP Weekend stay loaded." },
    ],
    before: {
      title: "Your stay at The Laurel",
      meta: "Jan 16–18 · VIP Weekend",
      lines: [
        { label: "VIP Weekend: room, 2 nights", amount: "$1,180.00" },
        { label: "Couples massage (included)", amount: "$0.00" },
        { label: "Private chef dinner (included)", amount: "$0.00" },
        { label: "Farm provisions basket (included)", amount: "$0.00" },
        { label: "Georgia sales tax", amount: "$94.40" },
        { label: "Pickens County hotel tax", amount: "$70.80" },
        { label: "GA hotel fee ($5/night)", amount: "$10.00" },
      ],
      total: "$1,355.20",
    },
    after: {
      title: "Your stay at The Laurel",
      meta: "Jan 16–18 · VIP Weekend",
      lines: [{ label: "VIP Weekend, all-inclusive", amount: "$1,355.20", note: "2 nights, couples massage, chef dinner, provisions · taxes included" }],
      total: "$1,355.20",
    },
    alsoChanges: ["Emailed receipt"],
    unchanged: ["Staff folio", "Tax Ledger", "Totals"],
    designDoc: "impl-package-stays §4.4",
    evidence: [
      { label: "Money untouched: zero ledger writes.", status: "pass" },
      { label: "Totals identical on all 214 past package stays (replayed).", status: "pass" },
      { label: "Staff folio and Tax Ledger still itemized.", status: "pass" },
      { label: "Receipt email rendered for 3 sample stays.", status: "pass" },
      { label: "612 automated checks passed; 4 new ones added.", status: "pass" },
      { label: "Independent review: no issues found.", status: "pass" },
    ],
    checklist: [
      { id: "c1", text: "Open the VIP Weekend sample stay as the guest. The folio shows one line." },
      { id: "c2", text: "Open the same stay as staff. Every item and tax line is still there." },
      { id: "c3", text: "Send yourself the receipt. It shows the same single line." },
      { id: "c4", text: "Open a regular (non-package) stay. Nothing changed." },
    ],
    approvals: [],
    engineer: {
      pr: "PR #72",
      branch: "feat/package-one-line-folio → stage",
      files: [
        "packages/domain/src/reports/folio-report.ts",
        "apps/portal/components/FolioView.tsx",
        "packages/communications/templates/receipt.ts",
      ],
      stats: "3 files · +84 −12",
      preview: "ts-portal-git-feat-package-one-line-folio.vercel.app",
      models: "builder: claude-opus-5 · judge: gpt-5 · replay: 214 reservations · vitest 612/612",
    },
  },
];

export const INVESTIGATIONS: DataInvestigation[] = [
  {
    id: "inv_58",
    requestNumber: 58,
    question: "The July 2027 tax report shows $179 unattributed. What is it?",
    askedBy: "Patrick",
    summary: "The $179 comes from one reservation, CR-9912, checking in Jul 12, 2027. It looks like stray test data, not a real guest.",
    findings: [
      { text: 'Guest name is "QA Test", with a placeholder email.', flag: "warn" },
      { text: "Created Aug 25, 2026, during the migration, but not in the migration's records.", flag: "warn" },
      { text: "No payment was ever taken. The tax line has no tax jurisdiction.", flag: "warn" },
      { text: "No other reservation in 2027 has this pattern.", flag: "ok" },
    ],
    proposedFix: [
      { record: "Reservation CR-9912", now: "confirmed", after: "cancelled" },
      { record: "Tax line · $179.00", now: "posted", after: "voided (kept for audit)" },
      { record: "July 2027 unattributed tax", now: "$179.00", after: "$0.00" },
    ],
    affects: "1 reservation and 1 ledger line. Nothing is deleted. A one-click restore is prepared and tested on a copy first.",
    status: "awaiting-approval",
    engineer: "20260927000001_investigate_july2027_unattributed_tax_READONLY.sql · 3 queries · 0 writes",
  },
];

export const DATA_CHECKS: DataCheck[] = [
  { id: "dc1", name: "Every reservation balance matches its ledger", lastRun: "06:00", result: "pass", detail: "1,376 rows" },
  { id: "dc2", name: "Card payments match Stripe", lastRun: "06:00", result: "pass", detail: "212 charges" },
  { id: "dc3", name: "No taxes without a jurisdiction", lastRun: "06:00", result: "warn", detail: "1 found · #58" },
  { id: "dc4", name: "No overlapping bookings per villa", lastRun: "06:00", result: "pass", detail: "All villas" },
];

export const DOCS: Doc[] = [
  {
    id: "rulebook",
    kind: "rulebook",
    title: "The Cypress rulebook",
    status: "living",
    updatedAt: "2 h ago",
    source: "ts-platform/CLAUDE.md §0, §4, §5, §8",
    sections: [
      { heading: "Money is computed in one place", body: "Every price, tax, folio total and refund comes from one engine. The booking page, the staff portal and the receipts never do their own arithmetic." },
      { heading: "A guest's bill is a list of entries, never a stored total", body: "Each dollar is one entry. The balance is always added up fresh, so it can't drift." },
      { heading: "Cancellations use the rules from the day of booking", body: "If you change the cancellation policy, existing bookings keep theirs." },
      { heading: "Guest credit is used before any card", body: "A guest with a voucher never gets charged by card for an amount the voucher covers." },
      { heading: "Things only the owner decides", body: "Refunds and write-offs. Tax rates and fees. Anything that changes a past booking's money." },
    ],
  },
  {
    id: "req-gift-package",
    kind: "requirements",
    title: "Requirements: gift a package stay",
    status: "draft",
    updatedAt: "Yesterday",
    source: "Consultation with Melissa, Sep 27 (voice)",
    sections: [
      { heading: "Goal", body: "A guest can buy a package stay as a gift, pay now, and send it to someone who books their own dates later." },
      { heading: "Confirmed requirements", body: "Gift is paid in full at purchase. Recipient gets an email with a code. The code works for any villa, subject to availability. Gifts expire after 12 months." },
      { heading: "Open questions", body: "Can the buyer choose the villa? What happens to unused value if the recipient books a cheaper stay?" },
    ],
  },
  {
    id: "impl-package-stays",
    kind: "design",
    title: "Design: package stays",
    status: "approved",
    updatedAt: "Sep 21",
    source: "cypress-actions/impl-package-stays.md",
    sections: [
      { heading: "What a package is", body: "Room nights plus optional catalog items, sold at one all-in price or price plus taxes, with stay rules tied to the calendar rules." },
      { heading: "§4.4 Guest folio display", body: "An all-inclusive package shows the guest one line. Staff and the Tax Ledger keep itemized lines (request #50)." },
    ],
  },
  {
    id: "d-31",
    kind: "decision",
    title: "D-31 Package folios show one line to guests",
    status: "approved",
    updatedAt: "Today",
    source: "Change Room #50, decided by Tanner",
    sections: [{ heading: "Decision", body: "Package folios show one all-in line to guests, taxes included, on screen and on receipts. Staff keep the itemized view." }],
  },
  {
    id: "runbook-release",
    kind: "runbook",
    title: "Runbook: releasing a change",
    status: "living",
    updatedAt: "Sep 20",
    source: "cypress-actions/deployment.md",
    sections: [{ heading: "How a change goes live", body: "Branch from stage, preview, test, merge to stage, verify on staging, promote to main. The engine does this; this page records how." }],
  },
];

export const FACTS: Fact[] = [
  { name: "Waterfall height", value: "55 ft", conflict: "Amenities and Experience pages say 50 ft." },
  { name: "Acres", value: "48" },
  { name: "Drive from Atlanta", value: "50 min" },
  { name: "Villas", value: "3" },
  { name: "Guests", value: "Adults only" },
];

export const DRIFT: Drift[] = [
  { id: "dr1", docSays: "Every catalog item must have its own refund policy (manager guide).", siteDoes: "Items without one fall back to the room policy." },
];

export const CONSULTATIONS: Consultation[] = [
  {
    id: "con_gift",
    title: "Gift a package stay",
    date: "Sep 27 · 14:00",
    mode: "voice",
    participants: ["Melissa", "Consulting agent"],
    stage: "requirements",
    transcriptExcerpt: [
      { speaker: "Melissa", text: "People keep calling to ask if they can buy a stay for their parents' anniversary." },
      { speaker: "Agent", text: "Should the gift be for a specific villa and dates, or something the recipient books later?" },
      { speaker: "Melissa", text: "Later. They pick their own dates. But it has to be paid up front." },
      { speaker: "Agent", text: "Understood. Does the gift expire?" },
      { speaker: "Melissa", text: "A year feels right." },
    ],
    requirements: [
      { id: "g1", text: "Gift is paid in full at purchase.", confirmed: true },
      { id: "g2", text: "Recipient gets an email with a redeemable code.", confirmed: true },
      { id: "g3", text: "Code works for any villa, subject to availability.", confirmed: true },
      { id: "g4", text: "Gifts expire 12 months after purchase.", confirmed: true },
      { id: "g5", text: "Buyer can add a personal message.", confirmed: false },
    ],
    openQuestions: [
      { q: "Can the buyer choose the villa?" },
      { q: "If the recipient books a cheaper stay, what happens to the difference?" },
    ],
    designDoc: "req-gift-package",
  },
  {
    id: "con_spa",
    title: "Spa booking on mobile",
    date: "Sep 25 · 10:30",
    mode: "meeting",
    participants: ["Tanner", "Chris", "Consulting agent"],
    stage: "building",
    transcriptExcerpt: [{ speaker: "Tanner", text: "Two guests couldn't find where to book a massage on their phones." }],
    requirements: [{ id: "s1", text: "Spa booking is reachable in one tap from every villa page on mobile.", confirmed: true }],
    openQuestions: [],
  },
];

export const RELEASES: Release[] = [
  { id: "rel_4", at: "Sep 26 · 14:02", title: "1200×630 social preview images", detail: "Every page now shares with a proper card on X, Facebook and LinkedIn. 11 pages." },
  { id: "rel_3", at: "Sep 24 · 10:40", title: "Itemized card charges in Stripe", detail: "Each card charge lists what the guest bought. Refunds made in Stripe now reach the folio.", requestNumber: 57 },
  { id: "rel_2", at: "Sep 22 · 16:15", title: "Cash, check and write-off payments", detail: 'The owner can settle a balance without a card. New "Where the money came from" report.', requestNumber: 54 },
  { id: "rel_1", at: "Sep 21 · 09:05", title: "Dashboard balances fixed", detail: "A $700 vs $350 mismatch, found by the owner, now guarded by a daily data check.", requestNumber: 53 },
];

export const PROOF: Proof = {
  verdict: "ready",
  verdictNote: "Every layer is green for the changes waiting to ship.",
  suites: [
    { id: "t-types", layer: "types", name: "Type safety", description: "Every package type-checks in strict mode.", tests: 8, passed: 8, lastRun: "11:47", durationSec: 41, heldOut: false, writtenBy: "engine" },
    { id: "t-lint", layer: "lint", name: "Lint", description: "Code style and common-mistake rules.", tests: 8, passed: 8, lastRun: "11:47", durationSec: 22, heldOut: false, writtenBy: "engine" },
    { id: "t-unit", layer: "unit", name: "Unit tests", description: "Pricing, tax, cancellation, folio and payments engines.", tests: 548, passed: 548, lastRun: "11:47", durationSec: 64, heldOut: false, writtenBy: "engine" },
    { id: "t-rules", layer: "domain-rules", name: "Money rules (oracle)", description: "An independent recomputation checks every total to the penny.", tests: 64, passed: 64, lastRun: "11:47", durationSec: 18, heldOut: true, writtenBy: "judge" },
    { id: "t-journeys", layer: "journeys", name: "Guest journeys", description: "Browse → book → pay (test card) → cancel, on synthetic guests.", tests: 12, passed: 12, lastRun: "11:52", durationSec: 210, heldOut: true, writtenBy: "judge" },
    { id: "t-visual", layer: "visual", name: "Visual check", description: "Before/after screenshots of every page the change touches.", tests: 23, passed: 23, lastRun: "11:55", durationSec: 95, heldOut: false, writtenBy: "engine" },
    { id: "t-quality", layer: "quality", name: "Speed, SEO & sharing", description: "Lighthouse, meta tags and social previews on key pages.", tests: 11, passed: 10, lastRun: "06:00", durationSec: 120, heldOut: false, writtenBy: "engine" },
    { id: "t-data", layer: "data", name: "Data integrity", description: "Balances, Stripe matching, orphans, overlapping bookings.", tests: 4, passed: 3, lastRun: "06:00", durationSec: 30, heldOut: true, writtenBy: "judge" },
  ],
  datasets: [
    { id: "ds1", name: "Synthetic guests & stays", mirrors: "Production reservations (shape and volume, no real people)", rows: 4200, refreshed: "Sep 27", notes: "Includes package stays, cancellations, no-shows and prepaid stays." },
    { id: "ds2", name: "Synthetic ledger", mirrors: "Production ledger entries", rows: 18600, refreshed: "Sep 27", notes: "Every entry type and sign, including credit and write-offs." },
    { id: "ds3", name: "Test card payments", mirrors: "Stripe payment patterns", rows: 900, refreshed: "Sep 27", notes: "Declines, partial refunds, Dashboard refunds." },
  ],
  recentRuns: [
    { at: "Today 11:55", change: "#50 One-line folio", result: "ready", detail: "671/671 checks · replay 214 stays" },
    { at: "Today 09:30", change: "#5 Georgia fee on add-on nights", result: "needs-work", detail: "Money rules: 2 totals off by $5.00. Sent back to build." },
    { at: "Yesterday", change: "#62 Social image headlines", result: "ready", detail: "Visual check 6/6 · Sharing 11/11" },
  ],
};

export const HEALTH: Health = {
  lighthouse: [
    { page: "/", performance: 84, accessibility: 97, bestPractices: 100, seo: 100, ranAt: "Today 06:00", source: "sample" },
    { page: "/p/[id]", performance: 79, accessibility: 96, bestPractices: 100, seo: 100, ranAt: "Today 06:00", source: "sample" },
    { page: "/p/[id]/sheet", performance: 91, accessibility: 98, bestPractices: 100, seo: 92, ranAt: "Today 06:00", source: "sample" },
  ],
  triage: "healthy",
  triageNote: "Stable and maintainable. Every change is small, tested, proven and recorded.",
  vitals: [
    { id: "v1", name: "Stability", score: 95, reading: "0 rollbacks · 0 escaped defects this month", explains: "How often changes break something in production.", trend: [80, 84, 88, 90, 92, 94, 95] },
    { id: "v2", name: "Test protection", score: 86, reading: "46 tests · catalog and assistant 100% · pages 70%", explains: "How much of what matters is guarded by tests.", trend: [40, 52, 63, 71, 78, 83, 86] },
    { id: "v3", name: "Structure", score: 90, reading: "One read-only catalog module · 0 circular dependencies", explains: "Whether the code is organised so a change stays local.", trend: [82, 84, 86, 87, 88, 89, 90] },
    { id: "v4", name: "Type safety", score: 98, reading: "Strict TypeScript everywhere", explains: "How many mistakes the compiler catches before anyone sees them.", trend: [92, 94, 95, 96, 97, 98, 98] },
    { id: "v5", name: "Freshness", score: 96, reading: "Next.js 16 · React 19 · 1 minor update pending", explains: "How far behind current versions the site is.", trend: [70, 78, 85, 90, 93, 95, 96] },
    { id: "v6", name: "Rulebook fit", score: 92, reading: "2 known doc↔code differences", explains: "Whether the code does what the rulebook says.", trend: [75, 80, 84, 87, 89, 91, 92] },
  ],
  hotspots: [
    { path: "lib/product.ts", why: "Cleans 10,000 crawled product records; every change gets the full product test suite.", changes90d: 14 },
    { path: "app/api/assistant/route.ts", why: "The shopping assistant: it may mention only products the catalog returns.", changes90d: 9 },
    { path: "components/voice-call.tsx", why: "Live voice; access codes and saved calls are protected behavior.", changes90d: 7 },
  ],
  treatmentPlan: [
    { phase: "Triage", goal: "Map the site and find what's fragile; branch protection and a stage branch.", status: "done" },
    { phase: "Stabilize", goal: "Tests around the catalog and the assistant first.", status: "done" },
    { phase: "Repair", goal: "Keep catalog access in one read-only module; every page goes through it.", status: "done" },
    { phase: "Strengthen", goal: "Raise page coverage and keep dependencies current.", status: "active" },
  ],
};

export const CONFIGURATION: Configuration = {
  env: [
    { key: "MONGODB_URI", service: "MongoDB", purpose: "The product catalog (read-only)", secret: true, requiredBy: ["site"], environments: { development: "set", preview: "set", production: "set" }, lastVerified: "2 min ago", howToGet: "MongoDB Atlas → Database → Connect → Drivers" },
    { key: "MONGODB_DB", service: "MongoDB", purpose: "Catalog database name", secret: false, requiredBy: ["site"], environments: { development: "set", preview: "set", production: "set" }, lastVerified: "2 min ago", howToGet: "The database that holds the product collection" },
    { key: "ANTHROPIC_API_KEY", service: "Anthropic", purpose: "The shopping assistant", secret: true, requiredBy: ["site"], environments: { development: "set", preview: "set", production: "set" }, lastVerified: "1 h ago", howToGet: "console.anthropic.com → API keys" },
    { key: "OPENAI_API_KEY", service: "OpenAI", purpose: "Talk mode (live voice) only", secret: true, requiredBy: ["site"], environments: { development: "set", preview: "set", production: "set" }, lastVerified: "1 h ago", howToGet: "platform.openai.com → Project → API keys (with a monthly limit)" },
    { key: "VOICE_MONGODB_URI", service: "MongoDB", purpose: "Talk mode's own database for calls and 30-day transcripts", secret: true, requiredBy: ["site"], environments: { development: "set", preview: "missing", production: "set" }, lastVerified: "Oct 12", howToGet: "MongoDB Atlas → a user with readWrite on the voice database only" },
    { key: "VOICE_ACCESS_CODE", service: "Platform", purpose: "Code shoppers enter before a voice call", secret: true, requiredBy: ["site"], environments: { development: "set", preview: "set", production: "set" }, lastVerified: "Oct 12", howToGet: "Chosen by the owner" },
    { key: "VOICE_SECRET", service: "Platform", purpose: "Signs voice session tokens", secret: true, requiredBy: ["site"], environments: { development: "set", preview: "set", production: "set" }, lastVerified: "Oct 12", howToGet: "openssl rand -hex 32, one per environment" },
  ],
  connections: [
    { id: "github", name: "GitHub", status: "connected", detail: "example/machine-shop. main is protected; the crew works on its own branches and stage.", lastTested: "2 min ago" },
    { id: "vercel", name: "Vercel", status: "connected", detail: "A preview for every change; production deploys from main; one-click rollback.", lastTested: "2 min ago" },
    { id: "catalog", name: "Catalog · MongoDB", status: "connected", detail: "Read-only. The crew can never write to the catalog.", lastTested: "2 min ago" },
    { id: "voice-db", name: "Voice database · MongoDB", status: "warning", detail: "No test copy for previews yet: voice is checked on development only.", lastTested: "Oct 12" },
    { id: "anthropic", name: "Claude · Anthropic", status: "connected", detail: "The crew and the shopping assistant.", lastTested: "Today" },
    { id: "openai", name: "GPT · OpenAI", status: "connected", detail: "Live voice only.", lastTested: "Today" },
  ],
  rolePermissions: [
    { role: "Builder", code: "Write (its own branch)", testData: "Read", liveData: "None", goLive: "No", money: "No" },
    { role: "Judge", code: "Read", testData: "Read", liveData: "None", goLive: "No", money: "No" },
    { role: "Team Lead", code: "Read", testData: "None", liveData: "None", goLive: "No", money: "No" },
    { role: "Release", code: "Merge (fast-forward only)", testData: "None", liveData: "None", goLive: "After your OK, or Low-tier policy", money: "No" },
  ],
  members: MEMBERS,
};

export const SKILLS: Skill[] = [
  { id: "sk-nextjs", name: "Next.js App Router", category: "engineering", description: "Build and upgrade Next.js sites: routing, server components, metadata, caching.", source: "strategic-machines", version: "16.3", enabled: true, usedBy: ["Builder", "Judge"] },
  { id: "sk-supabase-rls", name: "Supabase & row-level security", category: "data", description: "Migrations, RLS policies, tenant isolation, read-only investigations.", source: "strategic-machines", version: "2.4", enabled: true, usedBy: ["Builder", "Data investigator"] },
  { id: "sk-stripe", name: "Stripe payments", category: "engineering", description: "Payment intents, webhooks, refunds, idempotency, test-mode journeys.", source: "strategic-machines", version: "1.8", enabled: true, usedBy: ["Builder", "Judge"] },
  { id: "sk-ledger", name: "Ledger & money rules", category: "engineering", description: "Signed ledger entries, folios, tax categories, penny-exact oracle tests.", source: "strategic-machines", version: "1.2", enabled: true, usedBy: ["Builder", "Judge"] },
  { id: "sk-lighthouse", name: "Speed & Lighthouse remediation", category: "operations", description: "Diagnose and fix performance, accessibility, SEO and best-practice scores.", source: "strategic-machines", version: "1.5", enabled: true, usedBy: ["Builder"] },
  { id: "sk-og", name: "Social previews & SEO metadata", category: "content", description: "Titles, descriptions, 1200×630 cards, canonical URLs, sitemaps.", source: "strategic-machines", version: "1.1", enabled: true, usedBy: ["Builder"] },
  { id: "sk-synthetic", name: "Synthetic data that mirrors production", category: "testing", description: "Generate realistic test data with production's shape and volume and no real people.", source: "strategic-machines", version: "0.9", enabled: true, usedBy: ["Judge"] },
  { id: "sk-journeys", name: "Journey tests", category: "testing", description: "End-to-end browser tests for search, cart, booking and checkout.", source: "strategic-machines", version: "1.3", enabled: true, usedBy: ["Judge"] },
  { id: "sk-requirements", name: "Requirements from conversations", category: "consulting", description: "Turn a call or voice session into confirmed requirements and open questions.", source: "strategic-machines", version: "1.0", enabled: true, usedBy: ["Consulting agent"] },
  { id: "sk-design-docs", name: "Design docs", category: "design", description: "Write design docs with decisions, risks and a step-by-step plan, in the site's Library.", source: "strategic-machines", version: "1.0", enabled: true, usedBy: ["Consulting agent", "Builder"] },
  { id: "sk-triage", name: "Architecture triage", category: "engineering", description: "Assess a fragile codebase, stabilize it, then repair it area by area.", source: "strategic-machines", version: "0.8", enabled: true, usedBy: ["Builder", "Judge"] },
  { id: "sk-hospitality", name: "Hospitality booking rules", category: "data", description: "Cypress-specific: villas, packages, cancellation bands, Georgia taxes.", source: "custom", version: "3.1", enabled: true, usedBy: ["Builder", "Consulting agent"] },
];

export const ACCOUNT: Account = {
  org: ORG,
  plan: { id: "operate", name: "Operate", monthlyUsd: 1500, installFeeUsd: 2500, installPaid: true, renewsOn: "Nov 1, 2026" },
  card: { brand: "Visa", last4: "4242", expires: "08/28" },
  invoices: [
    { id: "inv_002", date: "Oct 1, 2026", description: "Operate · October", amountUsd: 1500, status: "paid" },
    { id: "inv_001", date: "Sep 20, 2026", description: "Boarding (fixed price)", amountUsd: 2500, status: "paid" },
  ],
  meters: [
    { provider: "Anthropic", model: "claude-opus-5-5", role: "Builder", tokensIn: 9_400_000, tokensOut: 820_000, costUsd: 31.2, limitUsd: 150 },
    { provider: "Anthropic", model: "claude-sonnet-5", role: "Team Lead and Designer", tokensIn: 3_100_000, tokensOut: 240_000, costUsd: 9.8, limitUsd: 60 },
    { provider: "OpenAI", model: "gpt-realtime", role: "Voice", tokensIn: 400_000, tokensOut: 160_000, costUsd: 4.1, limitUsd: 30 },
  ],
  dailyCapUsd: 20,
  monthToDateUsd: 45,
};

export const FILE_TREE: FileNode[] = [
  {
    name: "app",
    path: "app",
    type: "dir",
    children: [
      { name: "page.tsx", path: "app/page.tsx", type: "file" },
      { name: "p/[id]/page.tsx", path: "app/p/[id]/page.tsx", type: "file" },
      { name: "api/assistant/route.ts", path: "app/api/assistant/route.ts", type: "file" },
    ],
  },
  {
    name: "lib",
    path: "lib",
    type: "dir",
    children: [
      { name: "catalog.ts", path: "lib/catalog.ts", type: "file" },
      { name: "product.ts", path: "lib/product.ts", type: "file" },
    ],
  },
  { name: "CLAUDE.md", path: "CLAUDE.md", type: "file" },
];

export const FILE_CONTENTS: Record<string, string> = {
  "lib/catalog.ts": `/**
 * The catalog: the only code that touches MongoDB, and read-only.
 * Pages, the assistant and anything added later go through these functions.
 */
export const PAGE_SIZE = 24;

export async function searchProducts(query: string, page = 1) {
  const col = await products();
  return col.find(textFilter(query)).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).toArray();
}
`,
  "lib/product.ts": `/** Catalog documents → clean product data. Pure (no database), so it's unit tested and shared by pages and the assistant. */
export function toCard(raw: RawProduct): ProductCard {
  return { id: String(raw._id), name: text(raw.name), price: price(raw.price), inStock: raw.in_stock === true };
}
`,
  "CLAUDE.md": "# Machine Shop — working rules\n\n## The rules\n\n- The catalog is read-only. Every page and the assistant read it through lib/catalog.ts.\n- The assistant mentions only products its tools returned.\n- Every change adds tests; typecheck and the full suite pass before it ships.\n",
};
