import type { Account, Configuration, FileNode, Health, Member, Org, Partner, Site } from "@accelerator/domain";

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
