import { OWNER_GATED } from "./gates";
import type { RiskClass } from "./types";

/**
 * Complexity tiers (gen2-crew.md §17, D41). Complexity is rated against what
 * an expert agent can do and how long its run takes, not how hard the work
 * would feel to a person. The tier decides which decisions the client makes:
 * Low ships with none, Medium needs the Brief and Ship it, High keeps the full
 * gates. Protected risk always sets a High floor, and automatic escalation
 * only ever goes up.
 */

export const COMPLEXITIES = ["low", "medium", "high"] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

export const COMPLEXITY_LABEL: Record<Complexity, string> = { low: "Low", medium: "Medium", high: "High" };

/** What each tier means for the client, in one line. */
export const COMPLEXITY_PROMISE: Record<Complexity, string> = {
  low: "Ships on its own once every check passes. No decision needed.",
  medium: "You approve a short Brief, then Ship it on the preview.",
  high: "You approve the design, the plan, the preview and the release.",
};

/** The fixed rubric the Team Lead rates against, so ratings are consistent across sites and sessions. */
export const COMPLEXITY_RUBRIC = `Rate complexity for an expert coding agent, not for a person:
- low: one builder run (about 15 minutes of agent time or less), a few files, one capability, behavior clearly specified, no new data model, no protected area.
- medium: several builder runs (up to about two hours of agent time), new behavior in one or two capabilities, or assumptions worth confirming in a short brief.
- high: money, personal or business data, sign-in or security; schema or migration changes; changes across capabilities or to the architecture; external integrations; unclear requirements; or more than about eight runs.`;

const RANK: Record<Complexity, number> = { low: 0, medium: 1, high: 2 };

export const higherOf = (a: Complexity, b: Complexity): Complexity => (RANK[a] >= RANK[b] ? a : b);
export const isComplexity = (v: unknown): v is Complexity => typeof v === "string" && (COMPLEXITIES as readonly string[]).includes(v);

/** The lowest tier policy allows: protected risk (money, data, auth, security) is always High. */
export function complexityFloor(risk: RiskClass[]): Complexity {
  return risk.some((r) => OWNER_GATED.includes(r)) ? "high" : "low";
}

/** Whether a person may set this tier: anything at or above the floor, recommendation or not. */
export function canSetComplexity(chosen: Complexity, risk: RiskClass[]): boolean {
  return RANK[chosen] >= RANK[complexityFloor(risk)];
}

/** The tier in force: the chosen (or recommended) tier, never below the floor. */
export function effectiveComplexity(chosen: Complexity, risk: RiskClass[]): Complexity {
  return higherOf(chosen, complexityFloor(risk));
}

// ── Escalation: a build that reaches a protected area moves the item to High ──
const PROTECTED: { pattern: RegExp; why: string }[] = [
  { pattern: /(^|\/)(supabase\/)?migrations?\//i, why: "a database migration" },
  { pattern: /\.sql$/i, why: "database SQL" },
  { pattern: /(^|\/)(prisma|drizzle)\//i, why: "the database schema" },
  { pattern: /(^|\/)\.env/i, why: "environment settings" },
  { pattern: /(^|[\/._-])(auth|login|session|password|oauth)([\/._-]|$)/i, why: "sign-in" },
  { pattern: /(^|[\/._-])(payments?|stripe|checkout|billing|refunds?)([\/._-]|$)/i, why: "payments" },
  { pattern: /(^|\/)(middleware|proxy)\.(t|j)sx?$/i, why: "request middleware" },
  { pattern: /(^|[\/._-])(secrets?|vault|crypto)([\/._-]|$)/i, why: "secrets or encryption" },
];

/**
 * The protected areas a set of changed files reaches, by plain reason.
 * Empty means the change stayed within the tier's bounds.
 */
export function protectedAreas(files: string[]): string[] {
  const reasons = new Set<string>();
  for (const f of files) {
    const path = f.replace(/\\/g, "/");
    for (const p of PROTECTED) if (p.pattern.test(path)) reasons.add(p.why);
  }
  return [...reasons];
}

/** Escalation only goes up: a change below High that touched a protected area becomes High. */
export function escalation(current: Complexity, files: string[]): { complexity: "high"; reason: string } | null {
  if (current === "high") return null;
  const areas = protectedAreas(files);
  if (!areas.length) return null;
  return { complexity: "high", reason: `The change reached ${areas.join(", ")}, which needs the full review.` };
}

// ── The Team Lead's structured assessment ────────────────────────────────────
export type Assessment = { complexity: Complexity; ready: boolean; reason: string };

/**
 * The lead ends its reply with trailer lines:
 *   COMPLEXITY: low|medium|high
 *   READY: yes|no
 *   REASON: <one sentence>
 * Returns the reply without them and the assessment (null when there is none
 * or the tier isn't one of the three).
 */
export function readAssessment(text: string): { reply: string; assessment: Assessment | null } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const fields: Record<string, string> = {};
  const kept: string[] = [];
  for (const line of lines) {
    const m = /^\s*(COMPLEXITY|READY|REASON)\s*:\s*(.*?)\s*$/i.exec(line);
    if (m) fields[m[1]!.toUpperCase()] = m[2]!;
    else kept.push(line);
  }
  const reply = kept.join("\n").trim();
  const tier = fields.COMPLEXITY?.toLowerCase().replace(/[^a-z]/g, "");
  if (!isComplexity(tier)) return { reply, assessment: null };
  return {
    reply,
    assessment: { complexity: tier, ready: /^(yes|y|true|ready)\b/i.test(fields.READY ?? ""), reason: (fields.REASON ?? "").slice(0, 300) },
  };
}
