import type { RiskClass } from "./types";

/**
 * The Flywheel (work/flywheel.md v0.3). Pure rules: the rail, what the
 * Navigator can do next, the Protocol verdict the runner must pass, the
 * model catalog, and the Setup checklist. The API enforces these; the
 * console only displays them.
 */

// ── The rail ────────────────────────────────────────────────────────────────
export const RAIL = ["discuss", "design", "plan", "build", "prove", "try", "release", "learn"] as const;
export type RailStop = (typeof RAIL)[number];
export type WorkStage = RailStop | "done" | "cancelled";

export const RAIL_LABEL: Record<RailStop, string> = {
  discuss: "Discuss",
  design: "Design",
  plan: "Plan",
  build: "Build",
  prove: "Prove",
  try: "Try",
  release: "Release",
  learn: "Learn",
};

export type Cadence = "every_step" | "at_risk" | "run";
export const CADENCE_LABEL: Record<Cadence, string> = {
  every_step: "Ask after every step",
  at_risk: "Ask only at risky steps",
  run: "Run to the end",
};

export type StepStatus = "todo" | "running" | "done" | "blocked" | "skipped";
export type JobKind = "discuss" | "design" | "plan" | "build_step" | "checkout";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

// ── Models: the customer picks one per job (F15) ─────────────────────────────
export const MODEL_ROLES = ["consult", "design", "plan", "build", "judge"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export type Provider = "anthropic" | "openai" | "xai" | "google";

export const ROLE_LABEL: Record<ModelRole, string> = {
  consult: "Consult (the conversation)",
  design: "Design",
  plan: "Plan",
  build: "Build (edits the code)",
  judge: "Judge (reviews the work)",
};

export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI", xai: "xAI", google: "Google" };

/** Suggested models. Any model id the provider accepts can be typed in; `build` marks a supported agent harness. */
export const MODEL_CATALOG: { provider: Provider; model: string; label: string; build?: boolean }[] = [
  { provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5", build: true },
  { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", build: true },
  { provider: "anthropic", model: "claude-fable-5-1", label: "Claude Fable 5.1", build: true },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", build: true },
  { provider: "openai", model: "gpt-5", label: "GPT-5" },
  { provider: "xai", model: "grok-4", label: "Grok 4" },
  { provider: "google", model: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

/** Build needs an agent harness: Claude via the Agent SDK at launch (OpenAI Codex next). */
export const canBuildWith = (provider: Provider) => provider === "anthropic";

export type SiteModel = { role: ModelRole; provider: Provider; model: string; keySource: "ours" | "customer" };

/** New sites: Claude everywhere; the Judge on a different Claude model than the builder. */
export const DEFAULT_MODELS: SiteModel[] = [
  { role: "consult", provider: "anthropic", model: "claude-opus-5-5", keySource: "ours" },
  { role: "design", provider: "anthropic", model: "claude-opus-5-5", keySource: "ours" },
  { role: "plan", provider: "anthropic", model: "claude-opus-5-5", keySource: "ours" },
  { role: "build", provider: "anthropic", model: "claude-opus-5-5", keySource: "ours" },
  { role: "judge", provider: "anthropic", model: "claude-sonnet-5", keySource: "ours" },
];

export const modelLabel = (provider: string, model: string) =>
  MODEL_CATALOG.find((m) => m.provider === provider && m.model === model)?.label ?? model;

/** The site's models, falling back to the defaults role by role. */
export function resolveModels(saved: SiteModel[]): Record<ModelRole, SiteModel> {
  return Object.fromEntries(MODEL_ROLES.map((r) => [r, saved.find((m) => m.role === r) ?? DEFAULT_MODELS.find((m) => m.role === r)!])) as Record<
    ModelRole,
    SiteModel
  >;
}

export function validateModels(models: SiteModel[]): string[] {
  const problems: string[] = [];
  const build = models.find((m) => m.role === "build");
  const judge = models.find((m) => m.role === "judge");
  if (build && !canBuildWith(build.provider)) problems.push("Build needs a model with a supported agent harness (Claude at launch).");
  if (build && judge && build.provider === judge.provider && build.model === judge.model) {
    problems.push("The Judge should be a different model from the Builder, so it isn't marking its own work.");
  }
  for (const m of models) if (!m.model.trim()) problems.push(`Pick a model for ${ROLE_LABEL[m.role]}.`);
  return problems;
}

// ── What the Navigator can do next ─────────────────────────────────────────
export type WorkFacts = {
  stage: WorkStage;
  risk: RiskClass[];
  jobRunning: boolean;
  latestDesign: { version: number; approved: boolean } | null;
  planApproved: boolean;
  steps: { status: StepStatus }[];
};

const RISKY: RiskClass[] = ["money", "data", "auth", "security"];
export const isRisky = (risk: RiskClass[]) => risk.some((r) => RISKY.includes(r));

export type WorkActions = {
  ask: boolean;
  draftDesign: boolean;
  approveDesign: boolean;
  draftPlan: boolean;
  approvePlan: boolean;
  runNextStep: boolean;
  nextStep: number | null; // index into steps
};

/** The three gates (F4): design, plan, release. Money/data/auth never skip. */
export function workActions(f: WorkFacts): WorkActions {
  const closed = f.stage === "done" || f.stage === "cancelled";
  const idle = !f.jobRunning && !closed;
  const designApproved = !!f.latestDesign?.approved;
  const next = f.steps.findIndex((s) => s.status === "todo" || s.status === "blocked");
  const running = f.steps.some((s) => s.status === "running");
  return {
    ask: idle,
    draftDesign: idle,
    approveDesign: idle && !!f.latestDesign && !designApproved,
    draftPlan: idle && designApproved,
    approvePlan: idle && designApproved && f.steps.length > 0 && !f.planApproved,
    runNextStep: idle && f.planApproved && next >= 0 && !running,
    nextStep: next >= 0 ? next : null,
  };
}

/** The stage a Work item is at, from what exists (the rail never lies). */
export function stageFor(f: Omit<WorkFacts, "stage" | "jobRunning">): RailStop {
  if (f.planApproved && f.steps.length && f.steps.every((s) => s.status === "done" || s.status === "skipped")) return "prove";
  if (f.planApproved) return "build";
  if (f.latestDesign?.approved) return "plan";
  if (f.latestDesign) return "design";
  return "discuss";
}

// ── The Protocol verdict (F6) ────────────────────────────────────────────────
export type StepChecks = {
  typecheck: boolean;
  tests: { passed: number; failed: number; total: number } | null;
  testsBefore: number | null; // suite size before the step
  touchedTests: boolean; // the step's diff changed test files
  noTestsReason?: string; // accepted reason when a step legitimately adds no tests
  baseline: number | null; // the site's checkout baseline
};

/** A step is done only if every standing order holds. Returns the reasons it isn't. */
export function protocolVerdict(c: StepChecks): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!c.typecheck) reasons.push("Typecheck failed.");
  if (!c.tests) reasons.push("The test suite didn't run.");
  else {
    if (c.tests.failed > 0) reasons.push(`${c.tests.failed} test${c.tests.failed === 1 ? "" : "s"} failing.`);
    if (c.testsBefore != null && c.tests.total < c.testsBefore) reasons.push(`The suite shrank from ${c.testsBefore} to ${c.tests.total} tests.`);
    if (c.baseline != null && c.tests.total < c.baseline) reasons.push(`The suite is below the site's baseline of ${c.baseline} tests.`);
  }
  if (!c.touchedTests && !c.noTestsReason?.trim()) reasons.push("No tests were added or updated, and no reason was given.");
  return { ok: reasons.length === 0, reasons };
}

// ── Setup: Install · Checkout (§3) ───────────────────────────────────────────
export type SetupOwner = "strategic_machines" | "engine" | "client";
export type SetupStatus = "todo" | "waiting" | "done" | "failed" | "not_needed";

export const SETUP_OWNER_LABEL: Record<SetupOwner, string> = { strategic_machines: "Strategic Machines", engine: "Engine", client: "Client" };

export const SETUP_TEMPLATE: { code: string; phase: "install" | "checkout"; owner: SetupOwner; title: string }[] = [
  { code: "I1", phase: "install", owner: "strategic_machines", title: "GitHub repo in the client's organisation, with our GitHub App installed" },
  { code: "I2", phase: "install", owner: "strategic_machines", title: "Branches: main = production, stage = staging; main protected (pull requests with checks)" },
  { code: "I3", phase: "install", owner: "strategic_machines", title: "Vercel project linked: production = main, stage on a fixed domain, previews on" },
  { code: "I4", phase: "install", owner: "strategic_machines", title: "Vercel protection bypass and a read-only token for the engine" },
  { code: "I5", phase: "install", owner: "strategic_machines", title: "Two databases (production + test copy with synthetic data) and test payment keys" },
  { code: "I6", phase: "install", owner: "strategic_machines", title: "Keys per environment: test keys for Development and Preview; Production only in Vercel" },
  { code: "I7", phase: "install", owner: "strategic_machines", title: "Domains and DNS pointed at Vercel" },
  { code: "I8", phase: "install", owner: "client", title: "People invited with roles, and the Navigator named" },
  { code: "C1", phase: "checkout", owner: "engine", title: "Clone, install, build, typecheck and run the tests (records the baseline)" },
  { code: "C2", phase: "checkout", owner: "engine", title: "Push a branch and see its Vercel preview load" },
  { code: "C3", phase: "checkout", owner: "engine", title: "Reach the test database, and prove it isn't production" },
  { code: "C4", phase: "checkout", owner: "engine", title: "Every key in the manifest present and working for Development and Preview" },
  { code: "C5", phase: "checkout", owner: "engine", title: "Prove it can't reach production data or push to main" },
  { code: "C6", phase: "checkout", owner: "engine", title: "Rulebook (CLAUDE.md) and Stack card in place" },
  { code: "C7", phase: "checkout", owner: "engine", title: "Baselines: Lighthouse, test suite, data checks" },
];

export const setupDone = (items: { status: SetupStatus }[]) => items.length > 0 && items.every((i) => i.status === "done" || i.status === "not_needed");

/** The Agreement's text (§3). The Navigator signs a version of it. */
export function agreementText(siteName: string, cantSee: string[] = []): string {
  const unseen = [
    "Customers' calls and emails",
    "The business's plans and constraints",
    "Legal and brand rules",
    "Dashboards the engine has no key for (live payments, the domain registrar)",
    "How the site feels to a real customer",
    ...cantSee,
  ];
  return `# Working agreement: ${siteName}

## The engine will
- Design, plan, build, test and document every change.
- Keep the plan visible and ask before proceeding, at the cadence the Navigator chooses.
- Add tests with every change and never weaken the suite.
- Work only in test; never touch production data.
- Explain plainly, and recommend one option when asked "A or B?".

## The Navigator will
- Start the conversation: observations, complaints, ideas.
- Review and approve designs, plans and releases.
- Try every change on its preview, using the checklist.
- Give feedback, and say "stop" when something is off.
- Tell the engine what it can't see.

## What the engine can't see
${unseen.map((u) => `- ${u}`).join("\n")}
`;
}

// ── API shapes ───────────────────────────────────────────────────────────────
export type WorkItem = {
  id: string;
  number: number;
  /** "install": the site's installation conversation (no design/plan). */
  kind: "change" | "install";
  title: string;
  stage: WorkStage;
  cadence: Cadence;
  risk: RiskClass[];
  branch: string | null;
  planApproved: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkMessage = {
  id: string;
  authorKind: "person" | "model" | "system";
  authorLabel: string;
  model: string | null;
  stage: string;
  body: string;
  createdAt: string;
};

export type WorkDoc = { id: string; version: number; body: string; authorLabel: string; model: string | null; approvedAt: string | null; createdAt: string };

export type WorkStep = {
  id: string;
  position: number;
  title: string;
  detail: string;
  status: StepStatus;
  evidence: { summary?: string; reasons?: string[]; checks?: StepChecks; commit?: string; files?: string[] };
};

export type Job = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  provider: string;
  model: string;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type JobEvent = { id: number; at: string; kind: "log" | "tool" | "check" | "status"; text: string };

export type WorkDetail = {
  work: WorkItem;
  messages: WorkMessage[];
  designs: WorkDoc[];
  steps: WorkStep[];
  jobs: Job[];
  events: JobEvent[];
  actions: WorkActions;
  models: Record<ModelRole, SiteModel>;
  runnerOnline: boolean;
};

export type SetupItem = { code: string; phase: "install" | "checkout"; title: string; owner: SetupOwner; status: SetupStatus; note: string | null; evidence: Record<string, unknown>; updatedAt: string };

export type SiteSetup = {
  items: SetupItem[];
  agreement: { version: number; body: string; signedAt: string | null } | null;
  settings: { repo: string | null; repoPath: string | null; baseBranch: string; stageUrl: string | null; baselineTests: number | null };
  runnerOnline: boolean;
  ready: boolean;
};

/** What the runner receives with a job. */
export type JobContext = {
  job: Job & { role: ModelRole; input: Record<string, unknown> };
  site: { id: string; slug: string; name: string; url: string; repoPath: string | null; baseBranch: string; stack: string | null; baselineTests: number | null; repo: string | null };
  work: (WorkItem & { messages: WorkMessage[]; design: WorkDoc | null; steps: WorkStep[] }) | null;
  /** Installation conversations only: what the engine needs to diagnose setup (never key values). */
  setup?: {
    items: Pick<SetupItem, "code" | "title" | "owner" | "status" | "note">[];
    agreementSigned: boolean;
    settings: SiteSetup["settings"];
    checkoutLog: string[];
    keysSet: string[];
    manifest: string[];
  };
};

// ── The keys vault (values never leave the API) ─────────────────────────────
/** development + preview: the site's test keys. engine: keys the Accelerator uses for this site (e.g. GITHUB_TOKEN). */
export const VAULT_ENVS = ["development", "preview", "engine"] as const;
export type VaultEnv = (typeof VAULT_ENVS)[number];
export type SecretStatus = { environment: VaultEnv; name: string; last4: string; updatedAt: string };

/** Keys the engine itself can use for a site, listed on Configuration even when the repo doesn't mention them. */
export const ENGINE_KEYS = [
  { name: "GITHUB_TOKEN", purpose: "Read the private repository (code browser) until the GitHub App is installed", howToGet: "GitHub → Settings → Developer settings → Fine-grained tokens → only this repository, Contents: read" },
  { name: "VERCEL_TOKEN", purpose: "Read deployments and preview URLs", howToGet: "Vercel → Account Settings → Tokens (scope: this project)" },
];
