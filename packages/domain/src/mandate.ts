/**
 * The versioned mandate (gen2-crew.md §10.1): what one Work item is
 * authorized to do. It records the outcome, scope, acceptance criteria,
 * budget and time limits, protected behavior, decision owners and a review
 * point. Every run names the version it worked under; a revision is audited
 * and voids the pending approvals it affects. A mandate clarifies authority:
 * it never lets the crew skip a gate its complexity tier requires.
 */

export type MandateBody = {
  outcome: string;
  scope: string[];
  outOfScope: string[];
  acceptance: string[];
  /** Model spend this item may use, in US dollars; null means the site's limits only. */
  budgetUsd: number | null;
  /** ISO date the work should be live by, if one was agreed. */
  dueBy: string | null;
  /** Behavior that must not change. */
  protected: string[];
  /** Who decides, in words ("the Owner decides prices; the Operator approves copy"). */
  decisionOwners: string;
  /** ISO date to review the mandate, if one was set. */
  reviewBy: string | null;
};

export type Mandate = MandateBody & { version: number; createdBy: string; createdAt: string };

export const EMPTY_MANDATE: MandateBody = { outcome: "", scope: [], outOfScope: [], acceptance: [], budgetUsd: null, dueBy: null, protected: [], decisionOwners: "", reviewBy: null };

const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 30).map((x) => x.slice(0, 400)) : []);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? v.slice(0, 10) : null);

/** A mandate from stored or submitted values, normalized. */
export function readMandate(v: unknown): MandateBody {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const budget = typeof o.budgetUsd === "number" ? o.budgetUsd : typeof o.budgetUsd === "string" && o.budgetUsd.trim() ? Number(o.budgetUsd) : null;
  return {
    outcome: String(o.outcome ?? "").trim().slice(0, 1000),
    scope: list(o.scope),
    outOfScope: list(o.outOfScope),
    acceptance: list(o.acceptance),
    budgetUsd: budget != null && Number.isFinite(budget) ? Math.round(budget * 100) / 100 : null,
    dueBy: date(o.dueBy),
    protected: list(o.protected),
    decisionOwners: String(o.decisionOwners ?? "").trim().slice(0, 400),
    reviewBy: date(o.reviewBy),
  };
}

export function mandateErrors(m: MandateBody): string[] {
  const e: string[] = [];
  if (m.outcome.length < 10) e.push("Say the outcome in a sentence: what changes for the business.");
  if (!m.acceptance.length) e.push("Add at least one acceptance criterion a test or a person can check.");
  if (m.budgetUsd != null && (m.budgetUsd <= 0 || m.budgetUsd > 10_000)) e.push("The budget must be between $0 and $10,000.");
  if (m.dueBy && m.reviewBy && m.reviewBy > m.dueBy) e.push("Review the mandate before it is due, not after.");
  return e;
}

export type MandateChange = { field: keyof MandateBody; label: string };

const LABEL: Record<keyof MandateBody, string> = {
  outcome: "outcome", scope: "scope", outOfScope: "out of scope", acceptance: "acceptance criteria", budgetUsd: "budget",
  dueBy: "due date", protected: "protected behavior", decisionOwners: "decision owners", reviewBy: "review date",
};

export function mandateChanges(before: MandateBody | null, after: MandateBody): MandateChange[] {
  const keys = Object.keys(LABEL) as (keyof MandateBody)[];
  if (!before) return keys.filter((k) => JSON.stringify(after[k]) !== JSON.stringify(EMPTY_MANDATE[k])).map((field) => ({ field, label: LABEL[field] }));
  return keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((field) => ({ field, label: LABEL[field] }));
}

/**
 * Which pending approvals a revision voids. Changing what is built or how it
 * is accepted voids the plan and the release decisions made on the old
 * terms; a budget, date or owner change voids nothing already decided.
 */
export function mandateVoids(changes: MandateChange[]): ("approve_plan" | "approve_try" | "ship" | "auto_ship")[] {
  const material = changes.some((c) => c.field === "outcome" || c.field === "scope" || c.field === "outOfScope" || c.field === "acceptance" || c.field === "protected");
  return material ? ["approve_plan", "approve_try", "ship", "auto_ship"] : [];
}

/** Spend against the mandate's budget: the crew stops at the limit and asks. */
export function budgetState(m: Pick<MandateBody, "budgetUsd"> | null, spentUsd: number): { limit: number | null; spent: number; over: boolean; near: boolean } {
  const spent = Math.round(spentUsd * 100) / 100;
  if (!m?.budgetUsd) return { limit: null, spent, over: false, near: false };
  return { limit: m.budgetUsd, spent, over: spent >= m.budgetUsd, near: spent >= m.budgetUsd * 0.8 };
}

/** The mandate as every run reads it. */
export function mandateBlock(m: Mandate | null): string {
  if (!m) return "";
  const sec = (title: string, items: string[]) => (items.length ? `${title}:\n${items.map((x) => `- ${x}`).join("\n")}` : "");
  return [
    `THE MANDATE (v${m.version}; work only inside it, and say so if the work needs more)`,
    `Outcome: ${m.outcome}`,
    sec("In scope", m.scope),
    sec("Out of scope", m.outOfScope),
    sec("Acceptance criteria (prove each one)", m.acceptance),
    sec("Protected behavior (must not change)", m.protected),
    m.budgetUsd != null && `Budget: $${m.budgetUsd.toFixed(2)} of model spend.`,
    m.dueBy && `Due by: ${m.dueBy}.`,
    m.decisionOwners && `Decision owners: ${m.decisionOwners}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A first mandate drafted from the approved Brief or design, for a person to
 * confirm: the summary or goal becomes the outcome, "What changes" the
 * scope, "What stays protected" the protected behavior, and "How we'll prove
 * it" the acceptance criteria.
 */
export function mandateFromDocument(body: string): MandateBody {
  const sections = new Map<string, string>();
  let current = "";
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+?)\s*(\(.*\))?\s*$/.exec(line);
    if (h) {
      current = h[1]!.toLowerCase();
      sections.set(current, "");
    } else if (current) sections.set(current, `${sections.get(current)}${line}\n`);
  }
  const find = (...names: string[]) => [...sections.entries()].find(([k]) => names.some((n) => k.startsWith(n)))?.[1] ?? "";
  const bullets = (s: string) => s.split("\n").map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim()).filter((l) => l && !/^none\.?$/i.test(l));
  const outcome = find("summary", "goal").replace(/\s+/g, " ").trim();
  return readMandate({
    outcome,
    scope: bullets(find("what changes", "changes", "scope")),
    outOfScope: bullets(find("out of scope")),
    acceptance: bullets(find("how we'll prove", "how we will prove")),
    protected: bullets(find("what stays protected")),
  });
}
