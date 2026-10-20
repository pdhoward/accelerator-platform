import type { Domain } from "./domains";
import type { JobKind, ModelRole } from "./flywheel";

/**
 * The crew as configuration (gen2-crew.md §2.1, G2.3): a specialist is
 *   Skills (versioned know-how) + Tools (from the Toolbelt) + Permissions
 *   (gates it must stop at) + Model (per role, chosen per site).
 * The catalog and the crew and domain skill tiers are code, reviewed in git;
 * partner, company and site skills and each site's crew settings are data.
 * Pure: the API reads the records, this decides what each run is given.
 */

export const CREW_CATALOG_VERSION = 1;

export const SPECIALISTS = ["lead", "designer", "planner", "builder", "judge", "release", "surveyor", "librarian", "skillsmith"] as const;
export type SpecialistId = (typeof SPECIALISTS)[number];

export type Specialist = {
  id: SpecialistId;
  label: string;
  /** What it is accountable for, in business words (the client's Crew card). */
  remit: string;
  /** The model setting it runs on (Configuration → models), or null when it runs no model in v0. */
  role: ModelRole | null;
  /** The job kinds it carries out. */
  jobs: JobKind[];
  /** Toolbelt tools the catalog allows it; a site may narrow this, never widen it. */
  tools: string[];
  /** The gates it stops at: fixed by policy, shown as locks, never removable here. */
  permissions: string[];
  /** How it works in v0, stated plainly so nothing is overclaimed. */
  runs: "model" | "checks" | "rules";
};

const READ_TOOLS = ["work_status", "work_history", "work_decisions", "evidence_recent", "site_census", "site_capabilities"];
const MAKER_TOOLS = [...READ_TOOLS, "stripe_test_catalog", "rail_note"];

export const CREW: Record<SpecialistId, Specialist> = {
  lead: {
    id: "lead", label: "Team Lead", role: "consult", jobs: ["discuss"], runs: "model",
    remit: "Your accountable lead: understands the business, recommends, rates complexity, coordinates the specialists and reports exceptions.",
    tools: READ_TOOLS,
    permissions: ["Never approves on your behalf", "Never overrides the Judge or a gate", "Escalates money, data, auth and security to the Owner"],
  },
  designer: {
    id: "designer", label: "Designer", role: "design", jobs: ["design"], runs: "model",
    remit: "Writes the Brief (Medium) or the design (High): what changes, what stays protected, how it will be proven.",
    tools: MAKER_TOOLS,
    permissions: ["Works from the agreed conversation only", "A new version voids the earlier approval"],
  },
  planner: {
    id: "planner", label: "Planner", role: "plan", jobs: ["plan"], runs: "model",
    remit: "Turns the approved Brief or design into small, independently testable build steps.",
    tools: MAKER_TOOLS,
    permissions: ["Plans only what was approved", "A new plan voids the earlier approval"],
  },
  builder: {
    id: "builder", label: "Builder", role: "build", jobs: ["build_step"], runs: "model",
    remit: "Builds one plan step at a time on the Work item's own branch, with tests that prove it.",
    tools: MAKER_TOOLS,
    permissions: ["Test data and test keys only", "Never pushes, merges or touches main", "Never weakens, skips or deletes tests"],
  },
  judge: {
    id: "judge", label: "Judge", role: null, jobs: ["prove"], runs: "checks",
    remit: "Independent acceptance: typecheck, the full test suite and the production build on the exact candidate, then the preview.",
    tools: [],
    permissions: ["Separate from the Builder", "A failing check stops the release"],
  },
  release: {
    id: "release", label: "Release", role: null, jobs: ["release"], runs: "checks",
    remit: "Merges the proven candidate, checks it again, moves main only by fast-forward and confirms the live site answers.",
    tools: [],
    permissions: ["One release per site at a time", "Only after your Ship it (Medium) or Go live (High)", "Stops before main if anything isn't clean"],
  },
  surveyor: {
    id: "surveyor", label: "Surveyor", role: null, jobs: ["checkout"], runs: "checks",
    remit: "Checks the site's build, tests and keys, and proposes the capability inventory from the code.",
    tools: [],
    permissions: ["Read-only on your code", "Findings are proposals until a person accepts them"],
  },
  librarian: {
    id: "librarian", label: "Librarian", role: null, jobs: [], runs: "rules",
    remit: "Keeps the record: each Work item's approved decisions and evidence, written into your repository at Prove and exportable at any time.",
    tools: [],
    permissions: ["Writes only under docs/accelerator/", "Records what happened; never rewrites history"],
  },
  skillsmith: {
    id: "skillsmith", label: "Skillsmith", role: null, jobs: [], runs: "rules",
    remit: "Proposes lessons from the evidence (repeated repairs, failed proofs, escalations) for you to approve.",
    tools: [],
    permissions: ["Every output is a proposal, disabled until approved", "Never edits a live crew directly", "One-click rollback"],
  },
};

/** Which specialist carries out a job kind. */
export const specialistFor = (kind: JobKind): SpecialistId => (Object.values(CREW).find((s) => s.jobs.includes(kind))?.id ?? "lead");

// ── Skills: five tiers, crew → domain → partner → company → site (§2.2, §20) ──
export const SKILL_TIERS = ["crew", "domain", "partner", "org", "site"] as const;
export type SkillTier = (typeof SKILL_TIERS)[number];
export const SKILL_TIER_LABEL: Record<SkillTier, string> = { crew: "Crew", domain: "Domain", partner: "Partner", org: "Company", site: "Site" };

export type CrewSkill = {
  /** Stable key; a site disables a code skill by its key. */
  key: string;
  tier: SkillTier;
  title: string;
  body: string;
  version: number;
  /** Empty: every specialist that runs a model. */
  specialists: SpecialistId[];
  /** A safety skill can't be switched off by any more specific tier. */
  safety?: boolean;
  domain?: Domain;
  /** Data-tier skills: the row id, and whether it's switched on. */
  id?: string;
  enabled?: boolean;
};

export const CREW_SKILLS: CrewSkill[] = [
  {
    key: "crew.tdd-plane", tier: "crew", version: 1, specialists: [], safety: true, title: "Every change passes through the TDD plane",
    body: `- A change is done only when typecheck, the full test suite and the production build pass on the exact candidate.
- Add or update tests that prove the new behavior in the same step as the change.
- Never delete, skip or weaken a test to make a run pass. The suite never shrinks.
- If a check fails, find the cause inside the step's scope. Say what failed and why in one sentence.`,
  },
  {
    key: "crew.test-data", tier: "crew", version: 1, specialists: [], safety: true, title: "Test data and test keys only",
    body: `- Use the site's test keys and test databases. Never production keys, live payments or real customer data.
- Never read .env files, print environment variables or copy a key into code, logs or messages.
- Money, personal data, authentication and security changes are High complexity and need the Owner's decision.`,
  },
  {
    key: "crew.writing-standard", tier: "crew", version: 1, specialists: [], safety: true, title: "Writing standard (ASD-STE100 Simplified Technical English)",
    body: `Write everything a person reads (replies, Briefs, designs, plans, notes) in Simplified Technical English:
- One topic per sentence. Instructions: at most 20 words. Descriptions: at most 25 words.
- Use the active voice and the simple tenses. Say who does what: "The Builder adds a test", not "A test will be added".
- Write instructions as commands: "Approve the Brief", not "You should approve the Brief".
- Use one word for one meaning, and the client's own business terms. Do not use slang, idioms or vague words ("some", "various", "etc.").
- Put the result or the decision first, then the reason. Use lists for steps and for more than two items.
- Name a technical term only when it changes the decision, and then explain it in a few words.`,
  },
  {
    key: "crew.recommend", tier: "crew", version: 1, specialists: ["lead", "designer"], title: "Recommend, don't survey",
    body: `- When there are options, give at most three, then recommend one and say why in one sentence.
- State the business effect, the cost or risk, and what the decision authorizes.
- Say what you don't know. Never make certainty up; name the check that would settle it.`,
  },
  {
    key: "crew.small-steps", tier: "crew", version: 1, specialists: ["planner", "builder"], title: "Small steps that leave the site working",
    body: `- Each step is one coherent change that can be tested by itself and leaves the site working.
- Read the code around the change first and follow its existing patterns, names and comment density.
- Prefer changing existing code to adding new layers. Do not refactor outside the step's scope.`,
  },
  {
    key: "crew.handoff", tier: "crew", version: 1, specialists: ["lead", "designer", "planner", "builder"], title: "Handoffs carry the mandate",
    body: `- Work only inside the Work item's current mandate: its outcome, scope, acceptance criteria and protected behavior.
- If the work needs something the mandate does not cover, stop and say so. The Team Lead asks the decision owner.
- When you hand on, say what you finished, what is proven and what the next specialist needs.`,
  },
];

export const DOMAIN_SKILLS: CrewSkill[] = [
  {
    key: "commerce.catalog", tier: "domain", domain: "commerce", version: 1, specialists: [], title: "Commerce: the catalog feeds everything",
    body: `- Product, variant and price data feed every page, search and quote. Treat a catalog write as Medium at least.
- Show only products, prices and stock that the data returns. Never invent a product, a price or availability.
- Paginate catalog queries and bound every list. Check empty, out-of-stock and very long names.`,
  },
  {
    key: "commerce.money", tier: "domain", domain: "commerce", version: 1, specialists: [], title: "Commerce: checkout, pricing and promotions",
    body: `- Checkout, payment, tax, pricing and promotion rules are High complexity: money moves and errors cost sales.
- Prove money rules with tests on boundary cases: zero, rounding, currency, discounts that stack, refunds.
- Use the payment provider's test mode only. Never call a live payment endpoint.`,
  },
  {
    key: "commerce.journeys", tier: "domain", domain: "commerce", version: 1, specialists: ["designer", "planner", "builder"], title: "Commerce: protect the buying journey",
    body: `The critical journey is: find a product → compare → quote or cart → checkout. A change on one step must keep the others working. Name the journey steps a change touches, and test each one.`,
  },
  {
    key: "hospitality.availability", tier: "domain", domain: "hospitality", version: 1, specialists: [], title: "Hospitality: rates and availability",
    body: `- Rates, availability and booking rules decide what a guest can book and pay. Treat a change to them as High.
- Test boundary dates: check-in and check-out on the same day, month and year ends, time zones, minimum stays.
- Never show a room, a rate or availability that the data does not return.`,
  },
  {
    key: "hospitality.guests", tier: "domain", domain: "hospitality", version: 1, specialists: [], title: "Hospitality: guests, deposits and policies",
    body: `- Guest profiles are personal data. Deposits, payments, refunds and cancellation policies are contractual and move money.
- These changes are High complexity and need the Owner's decision. Use synthetic guests and stays in every test.
- The critical journey is: search availability → book → pay → confirm. Keep each step working.`,
  },
];

/** Partner, company and site skills as the API reads them. */
export type SkillRecord = {
  id: string;
  scope: "partner" | "org" | "site";
  title: string;
  body: string;
  version: number;
  specialists: SpecialistId[];
  enabled: boolean;
};

/** The site's crew settings (a versioned record). */
export type CrewConfig = {
  /** Narrowed Toolbelt allowances, per specialist; missing means the catalog's. */
  tools: Partial<Record<SpecialistId, string[]>>;
  /** Crew or domain skills switched off for this site (never a safety skill). */
  disabledSkills: string[];
};

export const DEFAULT_CREW_CONFIG: CrewConfig = { tools: {}, disabledSkills: [] };

export function readCrewConfig(v: unknown): CrewConfig {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const tools: CrewConfig["tools"] = {};
  if (o.tools && typeof o.tools === "object") {
    for (const [k, list] of Object.entries(o.tools as Record<string, unknown>)) {
      if ((SPECIALISTS as readonly string[]).includes(k) && Array.isArray(list)) tools[k as SpecialistId] = list.filter((x): x is string => typeof x === "string");
    }
  }
  const disabledSkills = Array.isArray(o.disabledSkills) ? o.disabledSkills.filter((x): x is string => typeof x === "string") : [];
  return { tools, disabledSkills };
}

/** What a crew change may not do; empty when it is allowed. */
export function crewConfigErrors(c: CrewConfig, domain: Domain | null): string[] {
  const errors: string[] = [];
  const codeSkills = [...CREW_SKILLS, ...DOMAIN_SKILLS.filter((s) => s.domain === domain)];
  for (const key of c.disabledSkills) {
    const s = codeSkills.find((x) => x.key === key);
    if (!s) errors.push(`There is no skill "${key}" for this site.`);
    else if (s.safety) errors.push(`"${s.title}" is a crew safety skill; no tier can switch it off.`);
  }
  for (const [id, list] of Object.entries(c.tools) as [SpecialistId, string[]][]) {
    const extra = list.filter((t) => !CREW[id].tools.includes(t));
    if (extra.length) errors.push(`The ${CREW[id].label} can't be given ${extra.join(", ")}; a site may narrow the catalog's tools, never widen them.`);
  }
  return errors;
}

/** The tools a specialist has on this site: the catalog's allowance, narrowed by the site. */
export function toolsAllowed(id: SpecialistId, c: CrewConfig = DEFAULT_CREW_CONFIG): string[] {
  const narrowed = c.tools[id];
  return narrowed ? CREW[id].tools.filter((t) => narrowed.includes(t)) : CREW[id].tools;
}

const applies = (s: { specialists: SpecialistId[] }, id: SpecialistId) => !s.specialists.length || s.specialists.includes(id);

/**
 * The skills one specialist runs with, assembled crew → domain → partner →
 * company → site. A more specific tier adds; it never removes a safety skill.
 */
export function assembleSkills(input: { specialist: SpecialistId; domain: Domain | null; config?: CrewConfig; records?: SkillRecord[] }): CrewSkill[] {
  const off = new Set(input.config?.disabledSkills ?? []);
  const code = [...CREW_SKILLS, ...DOMAIN_SKILLS.filter((s) => s.domain === input.domain)].filter((s) => applies(s, input.specialist) && (s.safety || !off.has(s.key)));
  const order: Record<SkillRecord["scope"], number> = { partner: 0, org: 1, site: 2 };
  const data = (input.records ?? [])
    .filter((r) => r.enabled && applies(r, input.specialist))
    .sort((a, b) => order[a.scope] - order[b.scope] || a.title.localeCompare(b.title))
    .map((r): CrewSkill => ({ key: `${r.scope}.${r.id}`, id: r.id, tier: r.scope, title: r.title, body: r.body, version: r.version, specialists: r.specialists, enabled: true }));
  return [...code, ...data];
}

/** Room for skills in one prompt; safety skills always fit first. */
export const SKILLS_BUDGET_CHARS = 14_000;

/** The skills block a run is given, with each skill's tier and version so the record says what it knew. */
export function skillsBlock(skills: CrewSkill[], budget = SKILLS_BUDGET_CHARS): string {
  if (!skills.length) return "";
  const ordered = [...skills.filter((s) => s.safety), ...skills.filter((s) => !s.safety)];
  const parts: string[] = [];
  let used = 0;
  let left = 0;
  for (const s of ordered) {
    const part = `### ${s.title} (${SKILL_TIER_LABEL[s.tier]} v${s.version})\n${s.body.trim()}`;
    if (!s.safety && used + part.length > budget) {
      left += 1;
      continue;
    }
    parts.push(part);
    used += part.length;
  }
  return `YOUR SKILLS (assembled crew → domain → partner → company → site; a more specific tier adds to a general one, never removes a safety skill)\n\n${parts.join("\n\n")}${left ? `\n\n(${left} more skill${left === 1 ? "" : "s"} didn't fit this run.)` : ""}`;
}

/** What a run's crew context holds: who it is, its skills, and the crew version it ran under. */
export type CrewContext = { specialist: SpecialistId; label: string; crewVersion: number; skills: CrewSkill[] };

/** One crew member on the client's Crew card (§2.4): remit, boundaries and actual activity. */
export type CrewMember = Specialist & {
  toolsAllowed: string[];
  skills: { key: string; title: string; tier: SkillTier; version: number; safety: boolean }[];
  activity: { jobs: number; lastAt: string | null; working: string | null };
};

export type CrewResponse = {
  catalogVersion: number;
  crewVersion: number;
  config: CrewConfig;
  domain: Domain | null;
  members: CrewMember[];
  /** Every skill the site's crew can run with, by tier, with whether this site has it on. */
  handbook: (CrewSkill & { on: boolean; locked: boolean })[];
  history: { version: number; note: string | null; by: string; at: string }[];
};
