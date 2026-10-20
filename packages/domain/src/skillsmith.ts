import type { SpecialistId } from "./crew";

/**
 * The Skillsmith v0 (gen2-crew.md §2.1, §10.6): proposals from evidence.
 * Deterministic rules read the site's recent failures and escalations; each
 * rule that fires drafts one site skill with the evidence that triggered it.
 * Every output is a proposal: disabled until the tier owner approves it, and
 * reversible. It is labelled "not evaluated" until replay and holdout
 * evaluation exist (the Crew Lab's test bench); it never claims an
 * improvement it hasn't measured.
 */

export type FailureFact = {
  work: number;
  title: string;
  at: string;
  kind: "step_checks" | "prove";
  ok: boolean;
  reasons: string[];
  files?: string[];
};

export type EscalationFact = { work: number; at: string; files: string[] };

export type ProposalDraft = {
  rule: string;
  title: string;
  body: string;
  specialists: SpecialistId[];
  rationale: string;
  evidence: { items: number[]; occurrences: number; window: string; examples: string[] };
};

/** How many distinct Work items must show a pattern before the Skillsmith proposes anything. */
export const MIN_ITEMS = 2;
export const WINDOW_DAYS = 60;

type Rule = {
  id: string;
  match: (reason: string) => boolean;
  kinds: FailureFact["kind"][];
  draft: (items: number[]) => Omit<ProposalDraft, "rule" | "evidence" | "rationale">;
};

const RULES: Rule[] = [
  {
    id: "tests-with-every-change",
    kinds: ["step_checks"],
    match: (r) => /No tests were added or updated/.test(r),
    draft: () => ({
      title: "Add a test with every change on this site",
      specialists: ["planner", "builder"],
      body: `- Each plan step names the test file it adds or changes.
- Add the test in the same step as the change, next to the code it proves (the site's existing *.test.ts pattern).
- If a step genuinely needs no test (copy or styling only), end with NO_TESTS_REASON and say why in one sentence.`,
    }),
  },
  {
    id: "typecheck-before-finish",
    kinds: ["step_checks", "prove"],
    match: (r) => /^Typecheck failed/.test(r),
    draft: () => ({
      title: "Run the typecheck before you finish",
      specialists: ["builder"],
      body: `- Run the site's typecheck after the last edit and before you report. Fix every error inside the step's scope.
- Do not silence errors with any, ts-ignore or casts. Fix the type.`,
    }),
  },
  {
    id: "keep-the-suite-green",
    kinds: ["step_checks", "prove"],
    match: (r) => /tests? failing|suite shrank|below the site's baseline/.test(r),
    draft: () => ({
      title: "Run the full test suite, not only the new tests",
      specialists: ["builder"],
      body: `- Run the whole suite after the change, not only the tests you added. A change can break a test elsewhere.
- When a test fails, read its output and fix the cause. Never delete, skip or weaken a test.`,
    }),
  },
  {
    id: "production-build",
    kinds: ["prove"],
    match: (r) => /production build failed/.test(r),
    draft: () => ({
      title: "Check the production build in the last step",
      specialists: ["planner", "builder"],
      body: `- The production build catches what the typecheck and the tests miss (server and client boundaries, missing env names, static generation).
- The plan's last step runs the site's build script and fixes what it reports.`,
    }),
  },
];

const inWindow = (at: string, now: string) => Date.parse(now) - Date.parse(at) <= WINDOW_DAYS * 86_400_000;

/**
 * The proposals the evidence supports now. `open` holds the rules that
 * already have an open or approved proposal, so a rule proposes once.
 */
export function skillsmithProposals(input: { failures: FailureFact[]; escalations: EscalationFact[]; now: string; open: string[] }): ProposalDraft[] {
  const out: ProposalDraft[] = [];
  const open = new Set(input.open);
  const failures = input.failures.filter((f) => !f.ok && inWindow(f.at, input.now));
  for (const rule of RULES) {
    if (open.has(rule.id)) continue;
    const hits = failures.filter((f) => rule.kinds.includes(f.kind) && f.reasons.some(rule.match));
    const items = [...new Set(hits.map((h) => h.work))].sort((a, b) => a - b);
    if (items.length < MIN_ITEMS) continue;
    const d = rule.draft(items);
    out.push({
      ...d,
      rule: rule.id,
      rationale: `${hits.length} run${hits.length === 1 ? "" : "s"} on ${items.length} Work items in the last ${WINDOW_DAYS} days failed the same way (${items.map((n) => `#${n}`).join(", ")}).`,
      evidence: { items, occurrences: hits.length, window: `${WINDOW_DAYS} days`, examples: [...new Set(hits.flatMap((h) => h.reasons.filter(rule.match)))].slice(0, 3) },
    });
  }

  // Escalations to High from the same area: tell the Team Lead to rate that area High from the start.
  const recent = input.escalations.filter((e) => inWindow(e.at, input.now));
  const byArea = new Map<string, Set<number>>();
  for (const e of recent) for (const f of e.files) {
    const area = f.split("/").slice(0, 2).join("/");
    byArea.set(area, (byArea.get(area) ?? new Set()).add(e.work));
  }
  for (const [area, set] of [...byArea.entries()].sort()) {
    const id = `escalation:${area}`;
    if (open.has(id) || set.size < MIN_ITEMS) continue;
    const items = [...set].sort((a, b) => a - b);
    out.push({
      rule: id,
      title: `Rate changes in ${area}/ High from the start`,
      specialists: ["lead"],
      body: `- Changes that touch ${area}/ reached a protected area on this site and were raised to High during the build.
- When a request will change ${area}/, rate it High in the assessment so the design and plan come to the Owner first.`,
      rationale: `${items.length} Work items (${items.map((n) => `#${n}`).join(", ")}) were raised to High mid-build by changes in ${area}/.`,
      evidence: { items, occurrences: items.length, window: `${WINDOW_DAYS} days`, examples: [] },
    });
  }
  return out;
}

export type SkillProposal = {
  id: string;
  kind: "new" | "edit" | "retire";
  skillId: string | null;
  scope: "org" | "site";
  title: string;
  body: string;
  previousBody: string | null;
  specialists: SpecialistId[];
  rationale: string;
  evidence: Record<string, unknown>;
  source: "skillsmith" | "person";
  status: "proposed" | "approved" | "rejected" | "rolled_back";
  evaluation: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

/** The labels §10.6 keeps distinct: proposed, evaluated, activated and measured are different claims. */
export function proposalLabel(p: Pick<SkillProposal, "status" | "evaluation">): string {
  if (p.status === "approved") return p.evaluation === "not evaluated" ? "Activated · not evaluated" : `Activated · ${p.evaluation}`;
  if (p.status === "rolled_back") return "Rolled back";
  if (p.status === "rejected") return "Declined";
  return p.evaluation === "not evaluated" ? "Proposed · not evaluated" : `Proposed · ${p.evaluation}`;
}
