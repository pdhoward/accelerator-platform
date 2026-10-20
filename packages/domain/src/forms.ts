/**
 * Generative forms (gen2-crew.md §9.5): a form is a spec the platform (or an
 * agent) fills, never code it writes. The console renders any FormSpec with
 * one FormRenderer; the API validates submissions against the same spec.
 * Pure.
 */

export type FormField =
  | { kind: "text"; name: string; label: string; hint?: string; required?: boolean; max?: number; placeholder?: string }
  | { kind: "textarea"; name: string; label: string; hint?: string; required?: boolean; max?: number; placeholder?: string; rows?: number }
  | { kind: "list"; name: string; label: string; hint?: string; required?: boolean; max?: number; placeholder?: string }
  | { kind: "number"; name: string; label: string; hint?: string; required?: boolean; min?: number; maxValue?: number; step?: number; prefix?: string }
  | { kind: "date"; name: string; label: string; hint?: string; required?: boolean }
  | { kind: "select"; name: string; label: string; hint?: string; required?: boolean; options: { value: string; label: string }[] };

export type FormSpec = { id: string; title: string; intro?: string; submit: string; fields: FormField[] };

export type FormValues = Record<string, string | number | string[] | null>;

/** Submitted values, normalized to the spec: unknown names dropped, lists split, numbers parsed. */
export function readForm(spec: FormSpec, input: unknown): FormValues {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: FormValues = {};
  for (const f of spec.fields) {
    const v = o[f.name];
    switch (f.kind) {
      case "list": {
        const items = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/\r?\n/) : [];
        out[f.name] = items.map((x) => x.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean).slice(0, 40).map((x) => x.slice(0, f.max ?? 400));
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : null;
        out[f.name] = n != null && Number.isFinite(n) ? n : null;
        break;
      }
      case "date":
        out[f.name] = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
        break;
      default:
        out[f.name] = typeof v === "string" ? v.trim().slice(0, (f as { max?: number }).max ?? 4000) : null;
    }
  }
  return out;
}

export function formErrors(spec: FormSpec, values: FormValues): Record<string, string> {
  const e: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = values[f.name];
    const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
    if (f.required && empty) {
      e[f.name] = `${f.label} is needed.`;
      continue;
    }
    if (empty) continue;
    if (f.kind === "number" && typeof v === "number") {
      if (f.min != null && v < f.min) e[f.name] = `${f.label} is at least ${f.min}.`;
      if (f.maxValue != null && v > f.maxValue) e[f.name] = `${f.label} is at most ${f.maxValue}.`;
    }
    if (f.kind === "select" && !f.options.some((o) => o.value === v)) e[f.name] = `Pick one of the ${f.label.toLowerCase()} options.`;
  }
  return e;
}

// ── Specs used by the platform ───────────────────────────────────────────────
export const MANDATE_FORM: FormSpec = {
  id: "mandate",
  title: "Mandate",
  intro: "What this Work item is authorized to do. Every run reads it; a change to what is built or how it is accepted voids the approvals made on the old terms.",
  submit: "Save the mandate",
  fields: [
    { kind: "textarea", name: "outcome", label: "Outcome", required: true, rows: 2, max: 1000, placeholder: "What changes for the business, in one or two sentences." },
    { kind: "list", name: "scope", label: "In scope", hint: "One per line." },
    { kind: "list", name: "outOfScope", label: "Out of scope", hint: "One per line." },
    { kind: "list", name: "acceptance", label: "Acceptance criteria", required: true, hint: "One per line; each one a test or a person can check." },
    { kind: "list", name: "protected", label: "Protected behavior", hint: "What must not change. One per line." },
    { kind: "number", name: "budgetUsd", label: "Budget (model spend)", prefix: "$", min: 1, maxValue: 10_000, step: 1, hint: "The crew stops and asks at the limit." },
    { kind: "date", name: "dueBy", label: "Live by" },
    { kind: "text", name: "decisionOwners", label: "Decision owners", max: 400, placeholder: "The Owner decides prices; the Operator approves copy." },
    { kind: "date", name: "reviewBy", label: "Review by" },
  ],
};

export const INTERVIEW_FORM: FormSpec = {
  id: "interview",
  title: "Site interview",
  intro: "The Team Lead's Boarding interview: what the site is for, what must never break, and who decides. The crew reads it on every run.",
  submit: "Save the interview",
  fields: [
    { kind: "list", name: "outcomes", label: "Business outcomes", required: true, hint: "What the site must achieve. One per line." },
    { kind: "list", name: "journeys", label: "Critical customer journeys", required: true, hint: "e.g. Search → product page → request a quote." },
    { kind: "list", name: "invariants", label: "Never break", hint: "Rules and behavior that must not change. One per line." },
    { kind: "textarea", name: "brand", label: "Brand and voice", rows: 3, max: 2000 },
    { kind: "list", name: "kpis", label: "KPIs", hint: "Name, how it's counted and the target. One per line." },
    { kind: "number", name: "monthlyBudgetUsd", label: "Monthly crew budget", prefix: "$", min: 0, maxValue: 100_000, step: 10 },
    { kind: "textarea", name: "authority", label: "Who decides what", rows: 2, max: 1000, placeholder: "The Owner approves money, data and releases; the Operator approves copy and design." },
  ],
};

export const CAPABILITY_FORM: FormSpec = {
  id: "capability",
  title: "Capability",
  submit: "Save",
  fields: [
    { kind: "text", name: "name", label: "Name", required: true, max: 120 },
    { kind: "text", name: "area", label: "Business area", required: true, max: 80 },
    { kind: "textarea", name: "purpose", label: "Purpose", rows: 2, max: 600 },
    { kind: "select", name: "importance", label: "Importance", required: true, options: [{ value: "critical", label: "Critical" }, { value: "standard", label: "Standard" }, { value: "supporting", label: "Supporting" }] },
    { kind: "list", name: "requirements", label: "Requirements", hint: "One per line: the behavior, then ' — ' and how it's accepted." },
    { kind: "list", name: "paths", label: "Technical links", hint: "Repository paths, one per line." },
  ],
};

export const SKILL_FORM: FormSpec = {
  id: "skill",
  title: "Propose a skill",
  intro: "Plain words are fine. It arrives as a proposal; the Owner approves it before the crew uses it.",
  submit: "Propose it",
  fields: [
    { kind: "text", name: "title", label: "Title", required: true, max: 120, placeholder: "Our brand voice for product descriptions" },
    { kind: "textarea", name: "body", label: "What the crew should know or do", required: true, rows: 6, max: 4000 },
    {
      kind: "select", name: "specialist", label: "Who uses it", required: true,
      options: [
        { value: "all", label: "The whole crew" }, { value: "lead", label: "Team Lead" }, { value: "designer", label: "Designer" },
        { value: "planner", label: "Planner" }, { value: "builder", label: "Builder" },
      ],
    },
    { kind: "select", name: "scope", label: "Applies to", required: true, options: [{ value: "site", label: "This site" }, { value: "org", label: "Every site in the company" }] },
  ],
};

/** The interview as a readable document, with its answers kept in a trailing comment so it reads back exactly. */
export function interviewMarkdown(v: FormValues): string {
  const list = (name: string) => ((v[name] as string[] | null) ?? []).map((x) => `- ${x}`).join("\n") || "_Not answered._";
  const text = (name: string) => (typeof v[name] === "string" && v[name] ? String(v[name]) : "_Not answered._");
  return `# Site interview

## Business outcomes
${list("outcomes")}

## Critical customer journeys
${list("journeys")}

## Never break
${list("invariants")}

## Brand and voice
${text("brand")}

## KPIs
${list("kpis")}

## Monthly crew budget
${v.monthlyBudgetUsd != null ? `$${v.monthlyBudgetUsd}` : "_Not set._"}

## Who decides what
${text("authority")}

<!-- answers: ${JSON.stringify(v).replace(/--/g, "-\\u002d")} -->
`;
}

export function readInterview(body: string | null | undefined): FormValues | null {
  const m = body ? /<!-- answers: (\{[\s\S]*\}) -->\s*$/.exec(body) : null;
  if (!m) return null;
  try {
    return readForm(INTERVIEW_FORM, JSON.parse(m[1]!));
  } catch {
    return null;
  }
}

/** What the crew reads from the interview on every run. */
export function interviewBlock(v: FormValues | null): string {
  if (!v) return "";
  const list = (name: string, title: string) => {
    const xs = (v[name] as string[] | null) ?? [];
    return xs.length ? `${title}:\n${xs.map((x) => `- ${x}`).join("\n")}` : "";
  };
  return [
    "THE SITE (from the Boarding interview)",
    list("outcomes", "Business outcomes"),
    list("journeys", "Critical journeys (keep each one working)"),
    list("invariants", "Never break"),
    typeof v.brand === "string" && v.brand ? `Brand and voice: ${v.brand}` : "",
    typeof v.authority === "string" && v.authority ? `Who decides: ${v.authority}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
