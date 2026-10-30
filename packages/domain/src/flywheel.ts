import type { Complexity } from "./complexity";
import { MAX_PROOF_REPAIRS, MAX_STEP_REPAIRS, type PendingDecision } from "./decisions";
import type { Domain } from "./domains";
import type { RiskClass } from "./types";

/**
 * The Flywheel (work/flywheel.md v0.3). Pure rules: the rail, what the
 * Navigator can do next, what the crew does next on its own (by complexity
 * tier, gen2-crew.md §17), the Protocol verdict the runner must pass, the
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

export type StepStatus = "todo" | "running" | "done" | "blocked" | "skipped";
export type JobKind = "discuss" | "design" | "plan" | "build_step" | "checkout" | "prove" | "release" | "ingest";
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
  /** The tier in force (never below the risk floor). */
  complexity: Complexity;
  /** The Team Lead says the request is understood well enough to start. */
  ready: boolean;
  /** Medium only: ship automatically when proof is green (D44). */
  autoShip: boolean;
  /** A person said "stop": nothing new starts until they resume. */
  paused: boolean;
  /** Automatic fix-and-prove-again rounds used after failed Proves. */
  proofRepairs: number;
  jobRunning: boolean;
  latestDesign: { version: number; approved: boolean } | null;
  planApproved: boolean;
  /** attempts: how many times the step has run (repairs are bounded by MAX_STEP_REPAIRS). */
  steps: { status: StepStatus; attempts?: number }[];
  /** The last Prove passed: checks green, branch pushed, preview found. */
  proven: boolean;
  /** The last Prove ran and failed: a person or the lead decides what's next. */
  proofFailed: boolean;
  /** The Navigator tried the preview and approved it (gate 3). */
  tryApproved: boolean;
  /** Merged to main and the live site checked. */
  released: boolean;
};

const allStepsDone = (steps: { status: StepStatus }[]) => steps.length > 0 && steps.every((s) => s.status === "done" || s.status === "skipped");

const RISKY: RiskClass[] = ["money", "data", "auth", "security"];
export const isRisky = (risk: RiskClass[]) => risk.some((r) => RISKY.includes(r));

export type WorkActions = {
  ask: boolean;
  /** Low: start building now, without waiting for the lead to say it's ready. */
  begin: boolean;
  /** Medium and High: draft the Brief (Medium) or design (High) now. */
  draftDesign: boolean;
  /** Medium: approve the Brief. High: approve the design. */
  approveDesign: boolean;
  /** High only: the plan is a client decision; on Medium it's the crew's. */
  draftPlan: boolean;
  approvePlan: boolean;
  /** Retry a step the Protocol blocked. Steps otherwise run on their own. */
  runNextStep: boolean;
  nextStep: number | null; // index into steps
  /** Prove again after a failed Prove. The first Prove runs on its own. */
  prove: boolean;
  /** High: the preview is up; try it and approve it for release (gate 3). */
  approveTry: boolean;
  /** Approved: merge to stage, then main, and check the live site. High's Go live, or a retry after a failed release. */
  release: boolean;
  /** Medium: the one release decision, "Ship it": approves the preview and releases it. */
  ship: boolean;
  /** Live: record what was learned and close the item. */
  close: boolean;
  /** Not going ahead: file the item as cancelled, at any stop before release. */
  cancel: boolean;
};

/**
 * What a person can do now, by tier (gen2-crew.md §17). Low has no decisions;
 * Medium has the Brief and Ship it; High keeps design, plan, Try and release.
 * Money/data/auth/security are always High (complexityFloor), so they never
 * skip a gate.
 */
export function workActions(f: WorkFacts): WorkActions {
  const closed = f.stage === "done" || f.stage === "cancelled";
  const idle = !f.jobRunning && !closed;
  const designApproved = !!f.latestDesign?.approved;
  const next = f.steps.findIndex((s) => s.status === "todo" || s.status === "blocked");
  const blocked = f.steps.some((s) => s.status === "blocked");
  const running = f.steps.some((s) => s.status === "running");
  const built = f.planApproved && allStepsDone(f.steps);
  const low = f.complexity === "low";
  const high = f.complexity === "high";
  return {
    ask: idle,
    begin: idle && low && !f.planApproved && f.steps.length === 0 && !f.released,
    draftDesign: idle && !low && !f.released,
    approveDesign: idle && !low && !!f.latestDesign && !designApproved,
    draftPlan: idle && high && designApproved && !f.released,
    approvePlan: idle && high && designApproved && f.steps.length > 0 && !f.planApproved,
    runNextStep: idle && f.planApproved && blocked && next >= 0 && !running,
    nextStep: next >= 0 ? next : null,
    prove: idle && built && f.proofFailed && !f.tryApproved && !f.released,
    approveTry: idle && high && built && f.proven && !f.tryApproved,
    release: idle && built && f.proven && f.tryApproved && !f.released,
    ship: idle && f.complexity === "medium" && built && f.proven && !f.tryApproved && !f.released,
    close: idle && f.released,
    cancel: idle && !f.released,
  };
}

/**
 * What the crew does next on its own, without a person pressing anything:
 * - begin: Low and ready: one step from the conversation, then build.
 * - design: Medium/High and ready: draft the Brief or design.
 * - plan: the Brief or design is approved: write the plan.
 * - approve_plan: Medium: the plan is the crew's, so it's accepted as written.
 * - build_step: the next approved step.
 * - repair_step: re-run a step the Protocol blocked, with what failed (bounded).
 * - prove: every step built: run the TDD plane's full checks and open a preview.
 * - repair_proof: add a step that fixes what a failed Prove found (bounded).
 * - ship: Low, or Medium with standing approval: release the proven preview.
 * Never past a decision the tier keeps for a person, never while paused, never
 * beyond the repair budget (then a blocked step or failed Prove waits for a
 * person), and never a second release attempt.
 */
export type AutoAction = "begin" | "design" | "plan" | "approve_plan" | "build_step" | "repair_step" | "prove" | "repair_proof" | "ship";

export function autoAction(f: WorkFacts): AutoAction | null {
  const closed = f.stage === "done" || f.stage === "cancelled";
  if (f.jobRunning || closed || f.released || f.paused) return null;
  if (f.steps.some((s) => s.status === "running")) return null;
  // A step the Protocol blocked: the crew repairs it itself, within budget, then it comes to a person.
  const blocked = f.steps.find((s) => s.status === "blocked");
  if (blocked) return (blocked.attempts ?? 1) <= MAX_STEP_REPAIRS ? "repair_step" : null;
  const low = f.complexity === "low";
  if (!f.planApproved) {
    if (low) return f.ready && f.steps.length === 0 ? "begin" : null;
    if (!f.latestDesign) return f.ready ? "design" : null;
    if (!f.latestDesign.approved) return null;
    const drafted = f.steps.some((s) => s.status !== "done");
    if (!drafted) return "plan";
    return f.complexity === "medium" ? "approve_plan" : null;
  }
  if (f.steps.some((s) => s.status === "todo")) return "build_step";
  if (!allStepsDone(f.steps)) return null;
  if (!f.proven) return !f.proofFailed ? "prove" : f.proofRepairs < MAX_PROOF_REPAIRS ? "repair_proof" : null;
  if (f.tryApproved) return null; // released by a person, or a failed release waiting for a retry
  if (low || (f.complexity === "medium" && f.autoShip)) return "ship";
  return null;
}

/** The stage a Work item is at, from what exists (the rail never lies). */
export function stageFor(f: Omit<WorkFacts, "stage" | "jobRunning">): RailStop {
  const built = f.planApproved && allStepsDone(f.steps);
  if (built && f.released) return "learn";
  if (built && f.proven && f.tryApproved) return "release";
  if (built && f.proven) return "try";
  if (built) return "prove";
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

// ── Prove and Release (flywheel.md F14) ──────────────────────────────────────
/** What a Prove run found. The runner reports facts; proveVerdict decides. */
export type ProveFacts = {
  typecheck: boolean;
  build: boolean | null; // null: the site has no build script
  tests: { passed: number; failed: number; total: number } | null;
  baseline: number | null;
  pushed: boolean;
  /**
   * The preview deployment's final state from GitHub ("success", "failure", "error"),
   * "missing" if none appeared, or "skipped" when the checks failed and nothing was pushed.
   */
  previewState: string;
};

export type ProveEvidence = ProveFacts & {
  ok: boolean;
  reasons: string[];
  branch: string;
  commit: string | null;
  previewUrl: string | null;
  /** HTTP status of the preview page; 401/403 means Vercel protection (sign in to Vercel to view). */
  previewStatus: number | null;
  at: string;
};

/** Prove passes only if every check is green and the preview deployed. Returns the reasons it isn't. */
export function proveVerdict(f: ProveFacts): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!f.typecheck) reasons.push("Typecheck failed.");
  if (f.build === false) reasons.push("The production build failed.");
  if (!f.tests) reasons.push("The test suite didn't run.");
  else {
    if (f.tests.failed > 0) reasons.push(`${f.tests.failed} test${f.tests.failed === 1 ? "" : "s"} failing.`);
    if (f.baseline != null && f.tests.total < f.baseline) reasons.push(`The suite is below the site's baseline of ${f.baseline} tests.`);
  }
  if (f.previewState === "skipped") {
    if (!reasons.length) reasons.push("The preview was skipped.");
  } else if (!f.pushed) reasons.push("The branch couldn't be pushed to GitHub.");
  else if (f.previewState === "missing") reasons.push("No preview deployment appeared. Check the Vercel project is linked to the repository.");
  else if (f.previewState !== "success") reasons.push(`The preview deployment ended in "${f.previewState}". See the Vercel build log.`);
  return { ok: reasons.length === 0, reasons };
}

/** What a Release run did. */
export type ReleaseEvidence = {
  ok: boolean;
  reasons: string[];
  stageCommit: string | null;
  mainCommit: string | null;
  productionState: string; // the production deployment's final state, or "missing"
  liveUrl: string;
  liveStatus: number | null;
  at: string;
};

/** Release passes when main moved, production deployed, and the live site answers. */
export function releaseVerdict(r: Pick<ReleaseEvidence, "mainCommit" | "productionState" | "liveStatus">): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!r.mainCommit) reasons.push("main wasn't updated.");
  if (r.productionState === "missing") reasons.push("No production deployment appeared for the new main commit.");
  else if (r.productionState !== "success") reasons.push(`The production deployment ended in "${r.productionState}".`);
  if (r.liveStatus == null || r.liveStatus >= 400) reasons.push(`The live site answered ${r.liveStatus ?? "nothing"}.`);
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
  risk: RiskClass[];
  /** The tier in force (gen2-crew.md §17). */
  complexity: Complexity;
  /** The Team Lead's recommendation and its reason, once it has assessed. */
  recommendedComplexity: Complexity | null;
  complexityReason: string | null;
  /** Who set the tier in force: the platform (from the recommendation) or a person. */
  complexitySetBy: "platform" | "person";
  /** The lead said the request is understood well enough to start. */
  ready: boolean;
  /** Medium: ship automatically when proof is green (D44). */
  autoShip: boolean;
  /** A person said "stop": nothing new starts until they resume. */
  paused: boolean;
  /** Automatic fix-and-prove-again rounds used after failed Proves. */
  proofRepairs: number;
  branch: string | null;
  planApproved: boolean;
  /** The preview of the proven branch (Try). */
  previewUrl: string | null;
  /** The last Prove run, passed or not. */
  proof: ProveEvidence | null;
  tryApproved: boolean;
  released: boolean;
  release: ReleaseEvidence | null;
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
  /** How many times the step has run. */
  attempts: number;
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
  /** What the crew will do next on its own, if anything (gen2-crew.md §17). */
  crewNext: AutoAction | null;
  /** The one decision a person must take now, shown as a card in the conversation (§17.4). */
  decision: PendingDecision | null;
  models: Record<ModelRole, SiteModel>;
  runnerOnline: boolean;
  /** The current mandate (§10.1), the spend against its budget, and the capabilities this item touched (G2.3a). */
  mandate?: import("./mandate").Mandate | null;
  budget?: { limit: number | null; spent: number; over: boolean; near: boolean } | null;
  capabilities?: { id: string; name: string; area: string }[];
};

export type SetupItem = { code: string; phase: "install" | "checkout"; title: string; owner: SetupOwner; status: SetupStatus; note: string | null; evidence: Record<string, unknown>; updatedAt: string };

export type SiteSetup = {
  items: SetupItem[];
  agreement: { version: number; body: string; signedAt: string | null } | null;
  settings: { repo: string | null; repoPath: string | null; baseBranch: string; stageUrl: string | null; baselineTests: number | null; domain: Domain | null };
  runnerOnline: boolean;
  ready: boolean;
};

/** What the runner receives with a job. */
export type JobContext = {
  /** generation: this claim's number; the runner renews and finishes with it, and a lapsed claim's result is refused (§14.1). */
  job: Job & { role: ModelRole; input: Record<string, unknown>; generation: number };
  site: { id: string; slug: string; name: string; url: string; repoPath: string | null; baseBranch: string; stack: string | null; baselineTests: number | null; repo: string | null; domain: Domain | null };
  /** agentSessionId: the Work item's agent session, resumed instead of cold-starting (§17 F4). */
  work: (WorkItem & { messages: WorkMessage[]; design: WorkDoc | null; steps: WorkStep[]; agentSessionId: string | null }) | null;
  /** The job's Toolbelt token (§1.2): the agent reaches the API's /mcp with it; it holds no other key. */
  toolbeltToken: string | null;
  /** Who runs this job and what it knows (G2.3): the specialist, its assembled skills and the crew version. */
  crew?: import("./crew").CrewContext | null;
  /** The Work item's current mandate (§10.1); the job records its version. */
  mandate?: import("./mandate").Mandate | null;
  /** The site's Boarding interview answers (§2.5), read on every run. */
  interview?: import("./forms").FormValues | null;
  /** Prove only: the record the Librarian writes into the repository (T5), when the site has /docs sync on. */
  record?: { path: string; body: string } | null;
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
