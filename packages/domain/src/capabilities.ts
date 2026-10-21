import { isTestPath } from "./census";
import type { Domain } from "./domains";
import { RAIL_LABEL, type WorkStage } from "./flywheel";

/**
 * The site capability inventory (gen2-crew.md §10.3, G2.3a): Site → business
 * area → capability → linked technical assets. The Survey proposes; a person
 * accepts. Lifecycle, operational condition and change progress are separate
 * dimensions and never collapse into one status. Pure.
 */

export type Lifecycle = "proposed" | "accepted" | "retired";
export type Importance = "critical" | "standard" | "supporting";

export type CapabilityTemplate = {
  key: string;
  area: string;
  name: string;
  purpose: string;
  importance: Importance;
  /** Repository paths that implement it. */
  match: RegExp;
  domain?: Domain;
};

const GENERIC: CapabilityTemplate[] = [
  { key: "site.home", area: "Site", name: "Home page", purpose: "The first page a visitor sees, and where they choose a path.", importance: "standard", match: /^(src\/)?app\/(\(\w+\)\/)?page\.(t|j)sx?$|^(src\/)?pages\/index\.(t|j)sx?$/ },
  { key: "site.accounts", area: "Accounts", name: "Sign-in and accounts", purpose: "People sign in and manage their account.", importance: "critical", match: /(^|\/)(auth|login|sign-?in|sign-?up|account|session)s?(\/|\.|-)/i },
  { key: "site.owner", area: "Operations", name: "Owner tools", purpose: "Pages and tools only the business uses.", importance: "supporting", match: /(^|\/)(owner|admin|dashboard)(\/|\.|-)/i },
];

const COMMERCE: CapabilityTemplate[] = [
  { key: "catalog.browse", area: "Catalog", name: "Browse the catalog", purpose: "Visitors see the products and their key facts.", importance: "critical", match: /(^|\/)(catalog|gallery|products?|collections?)(\/|\.|-)/i },
  { key: "catalog.search", area: "Catalog", name: "Search", purpose: "Visitors find a product by words, brand or attribute.", importance: "critical", match: /search/i },
  { key: "catalog.product", area: "Catalog", name: "Product page", purpose: "One product with its details, images and next step.", importance: "critical", match: /(^|\/)(p|product|products|item)\/\[[^/]+\]\/page\.(t|j)sx?$|product-card/i },
  { key: "catalog.sheets", area: "Catalog", name: "Product sheets", purpose: "A printable or PDF sheet for a product.", importance: "supporting", match: /(sheet|print|pdf)/i },
  { key: "sales.assistant", area: "Sales", name: "Shopping assistant", purpose: "An assistant answers questions about the products, using only what the catalog returns.", importance: "standard", match: /assistant/i },
  { key: "sales.voice", area: "Sales", name: "Voice assistant", purpose: "Visitors talk to the assistant by voice.", importance: "standard", match: /(^|\/)voice(\/|-|\.)/i },
  { key: "sales.quotes", area: "Sales", name: "Quotes", purpose: "Visitors ask for a quote; the business receives it.", importance: "critical", match: /quote/i },
  { key: "sales.cart", area: "Sales", name: "Cart", purpose: "Visitors collect products to buy.", importance: "critical", match: /(^|\/)(cart|basket|bag)(\/|\.|-)/i },
  { key: "sales.checkout", area: "Sales", name: "Checkout and payment", purpose: "Visitors pay; money moves.", importance: "critical", match: /(checkout|payment|stripe)/i },
  { key: "sales.orders", area: "Sales", name: "Orders", purpose: "Orders are recorded, confirmed and fulfilled.", importance: "critical", match: /(^|\/)(orders?|fulfil+ment)(\/|\.|-)/i },
].map((t) => ({ ...t, importance: t.importance as Importance, domain: "commerce" as const }));

const HOSPITALITY: CapabilityTemplate[] = [
  { key: "stay.availability", area: "Reservations", name: "Search availability", purpose: "Guests see which rooms are free for their dates.", importance: "critical", match: /(availability|calendar|rooms?)(\/|\.|-)/i },
  { key: "stay.rates", area: "Reservations", name: "Rates", purpose: "The right price for each room, date and plan.", importance: "critical", match: /(rates?|pricing|rate-plan)(\/|\.|-)/i },
  { key: "stay.booking", area: "Reservations", name: "Book a stay", purpose: "Guests book and change a reservation.", importance: "critical", match: /(book|reserv)/i },
  { key: "stay.payment", area: "Reservations", name: "Deposits and payment", purpose: "Deposits, payments and refunds; money moves.", importance: "critical", match: /(payment|deposit|refund|stripe|folio)/i },
  { key: "stay.policies", area: "Reservations", name: "Policies", purpose: "Cancellation and booking terms guests agree to.", importance: "standard", match: /(polic|cancel|terms)/i },
  { key: "stay.guests", area: "Guests", name: "Guest profiles", purpose: "Guests' details and preferences; personal data.", importance: "critical", match: /(guests?|profile)(\/|\.|-)/i },
  { key: "dining.tables", area: "Dining", name: "Table booking", purpose: "Guests book a table.", importance: "standard", match: /(table|restaurant|dining)/i },
].map((t) => ({ ...t, importance: t.importance as Importance, domain: "hospitality" as const }));

export const CAPABILITY_TEMPLATES: CapabilityTemplate[] = [...GENERIC, ...COMMERCE, ...HOSPITALITY];

/** Critical journeys per domain (§20): the order a customer moves through capabilities. */
export const CRITICAL_JOURNEYS: Record<Domain, { name: string; steps: string[] }[]> = {
  commerce: [{ name: "Buy", steps: ["catalog.search", "catalog.browse", "catalog.product", "sales.quotes", "sales.cart", "sales.checkout", "sales.orders"] }],
  hospitality: [{ name: "Stay", steps: ["stay.availability", "stay.rates", "stay.booking", "stay.payment"] }],
};

const SOURCE = /\.(t|j)sx?$|\.(mjs|cjs|vue|svelte|py|rb|go|php)$/;
const NOT_CODE = /(^|\/)(node_modules|dist|build|\.next|coverage|public|scripts|test|tests|__mocks__)\//;

export type CapabilityProposal = {
  key: string;
  area: string;
  name: string;
  purpose: string;
  importance: Importance;
  paths: string[];
  tests: string[];
  confidence: number;
  evidence: { template: string; matched: number; tests: number; basis: string };
};

/**
 * The Surveyor's proposal from the repository's file list: each template
 * whose pattern matches source files, with those files as technical links,
 * the tests that touch them and a confidence the reviewer can see the basis
 * of. Proposals only: nothing here becomes accepted without a person.
 */
export function proposeCapabilities(files: string[], domain: Domain | null): CapabilityProposal[] {
  const code = files.filter((f) => SOURCE.test(f) && !NOT_CODE.test(`${f}`) && !/\.d\.ts$/.test(f));
  const tests = files.filter((f) => isTestPath(f));
  const templates = CAPABILITY_TEMPLATES.filter((t) => !t.domain || t.domain === domain);
  const out: CapabilityProposal[] = [];
  for (const t of templates) {
    const paths = code.filter((f) => !isTestPath(f) && t.match.test(f)).sort();
    if (!paths.length) continue;
    const linked = tests.filter((f) => t.match.test(f) || paths.some((p) => sameModule(p, f))).sort();
    const confidence = Math.min(0.9, 0.5 + 0.1 * paths.length) + (linked.length ? 0.05 : 0);
    out.push({
      key: t.key, area: t.area, name: t.name, purpose: t.purpose, importance: t.importance, paths, tests: linked,
      confidence: Math.round(Math.min(0.95, confidence) * 100) / 100,
      evidence: { template: t.key, matched: paths.length, tests: linked.length, basis: `${paths.length} file${paths.length === 1 ? "" : "s"} match the ${t.name.toLowerCase()} pattern${linked.length ? `; ${linked.length} test file${linked.length === 1 ? "" : "s"} cover them` : "; no tests found for them"}.` },
    });
  }
  return out;
}

/** a/b/route.ts and a/b/route.test.ts, or lib/x.ts and lib/x.test.ts, are one module. */
function sameModule(file: string, test: string): boolean {
  const strip = (p: string) => p.replace(/(\.|-|_)(test|spec)(?=\.(t|j)sx?$)/, "").replace(/\.(t|j)sx?$/, "");
  return strip(file) === strip(test);
}

/** The capabilities a change touched, by the files it changed. */
export function capabilitiesTouched(caps: { id: string; paths: string[]; lifecycle: Lifecycle }[], files: string[]): { id: string; files: string[] }[] {
  return caps
    .filter((c) => c.lifecycle !== "retired")
    .map((c) => ({ id: c.id, files: files.filter((f) => c.paths.includes(f) || c.paths.some((p) => sameModule(p, f))) }))
    .filter((c) => c.files.length > 0);
}

// ── Condition and progress: two dimensions, never one status ────────────────
export const CONDITION_FRESH_DAYS = 14;

export type CapabilityCondition = { state: "verified" | "attention" | "unverified"; reason: string; at: string | null; ageDays: number | null };

/**
 * Operational condition from evidence, never from Work completion: verified
 * needs tests that cover the capability and a passing full-suite run on a
 * proven or released candidate within the freshness window.
 */
export function capabilityCondition(
  cap: { lifecycle: Lifecycle; tests: number },
  latestSuite: { ok: boolean; at: string; kind: string } | null,
  now: string,
): CapabilityCondition {
  if (cap.lifecycle !== "accepted") return { state: "unverified", reason: cap.lifecycle === "proposed" ? "Not accepted yet." : "Retired.", at: null, ageDays: null };
  if (!latestSuite) return { state: "unverified", reason: "No full test run has been recorded yet.", at: null, ageDays: null };
  const ageDays = Math.floor((Date.parse(now) - Date.parse(latestSuite.at)) / 86_400_000);
  if (!latestSuite.ok) return { state: "attention", reason: `The latest full test run (${latestSuite.kind}) failed.`, at: latestSuite.at, ageDays };
  if (!cap.tests) return { state: "unverified", reason: "No tests cover this capability yet.", at: latestSuite.at, ageDays };
  if (ageDays > CONDITION_FRESH_DAYS) return { state: "unverified", reason: `The last passing run is ${ageDays} days old (fresh means ${CONDITION_FRESH_DAYS}).`, at: latestSuite.at, ageDays };
  return { state: "verified", reason: `Its tests passed in the latest full run (${latestSuite.kind}).`, at: latestSuite.at, ageDays };
}

export type ProgressItem = { number: number; title: string; stage: string; phase: "discovery" | "design" | "building" | "testing" | "awaiting decision" | "released" };

const PHASE: Record<string, ProgressItem["phase"]> = {
  discuss: "discovery", design: "design", plan: "design", build: "building", prove: "testing", try: "awaiting decision", release: "awaiting decision", learn: "released", done: "released",
};

/** Change progress: each active Work item on the capability, shown separately rather than averaged. */
export function capabilityProgress(work: { number: number; title: string; stage: WorkStage }[]): ProgressItem[] {
  return work
    .filter((w) => w.stage !== "cancelled")
    .map((w) => ({ number: w.number, title: w.title, stage: w.stage in RAIL_LABEL ? RAIL_LABEL[w.stage as keyof typeof RAIL_LABEL] : "Done", phase: PHASE[w.stage] ?? "discovery" }))
    .sort((a, b) => b.number - a.number);
}

export type Capability = {
  id: string;
  key: string;
  area: string;
  name: string;
  purpose: string;
  lifecycle: Lifecycle;
  importance: Importance;
  paths: string[];
  tests: string[];
  requirements: { text: string; acceptance: string }[];
  version: number;
  source: "survey" | "template" | "person";
  confidence: number | null;
  evidence: Record<string, unknown>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  condition: CapabilityCondition;
  progress: ProgressItem[];
};

export type Scorecard = {
  accepted: number;
  proposed: number;
  retired: number;
  /** Of the accepted population only. */
  verified: number;
  attention: number;
  unverified: number;
  criticalAttention: number;
  /** A separate count: open Work items across the inventory (an item on two capabilities counts once). */
  pipeline: number;
};

export function scorecard(caps: Capability[]): Scorecard {
  const accepted = caps.filter((c) => c.lifecycle === "accepted");
  const open = new Set(caps.flatMap((c) => c.progress.filter((p) => p.phase !== "released").map((p) => p.number)));
  return {
    accepted: accepted.length,
    proposed: caps.filter((c) => c.lifecycle === "proposed").length,
    retired: caps.filter((c) => c.lifecycle === "retired").length,
    verified: accepted.filter((c) => c.condition.state === "verified").length,
    attention: accepted.filter((c) => c.condition.state === "attention").length,
    unverified: accepted.filter((c) => c.condition.state === "unverified").length,
    criticalAttention: accepted.filter((c) => c.importance === "critical" && c.condition.state === "attention").length,
    pipeline: open.size,
  };
}

export type CapabilitiesResponse = { capabilities: Capability[]; scorecard: Scorecard; journeys: { name: string; steps: { key: string; name: string; present: boolean }[] }[]; surveyedAt: string | null; sample?: boolean };

/** The domain's journeys, against what the inventory holds. */
export function journeysFor(domain: Domain | null, caps: Pick<Capability, "key" | "name" | "lifecycle">[]) {
  if (!domain) return [];
  return CRITICAL_JOURNEYS[domain].map((j) => ({
    name: j.name,
    steps: j.steps.map((key) => {
      const c = caps.find((x) => x.key === key && x.lifecycle !== "retired");
      return { key, name: c?.name ?? CAPABILITY_TEMPLATES.find((t) => t.key === key)?.name ?? key, present: !!c };
    }),
  }));
}
