/**
 * The Control Room's vocabulary. Shared by apps/api (which produces these)
 * and apps/console (which renders them) via packages/api-client.
 */

// ── Tenancy ───────────────────────────────────────────────────────────────
export type Role = "owner" | "operator" | "tester" | "viewer";

export type Member = { id: string; name: string; email: string; role: Role };

export type Org = { id: string; name: string; plan: PlanId };

export type Site = {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  url: string;
  repo: string;
  stack: string;
  status: "live" | "onboarding";
  lastReleaseAt: string;
};

export type Caller = { memberId: string; orgId: string; role: Role; name: string };

// ── The Loop ──────────────────────────────────────────────────────────────
/** Capture → Clarify → Commit → Build → Prove → Try → Ship → Watch. */
export type LoopStage = "clarify" | "build" | "prove" | "try" | "ship" | "watch" | "done";

export type Priority = "now" | "next" | "later";

export type RequestType =
  | "content"
  | "design"
  | "workflow"
  | "data"
  | "bug"
  | "feature"
  | "security"
  | "performance";

/** What a change touches. Drives gate policy. */
export type RiskClass = "display" | "content" | "code" | "money" | "data" | "auth" | "security";

/** accelerator.md §3.3 — how much autonomy the engine has for this change. */
export type AutonomyLevel = "AC1" | "AC2" | "AC3";

export type SiteRequest = {
  id: string;
  number: number;
  siteId: string;
  title: string;
  detail: string;
  type: RequestType;
  risk: RiskClass[];
  priority: Priority;
  stage: LoopStage | "new";
  source: string;
  createdAt: string;
  changeId?: string;
  note?: string;
};

export type Message = {
  at: string;
  from: "human" | "engine" | "decision";
  author: string;
  text: string;
  bullets?: string[];
};

export type EvidenceItem = { label: string; status: "pass" | "warn" | "fail"; detail?: string };

export type ChecklistStep = { id: string; text: string };

export type FolioLine = { label: string; amount: string; note?: string };

export type Change = {
  id: string;
  siteId: string;
  requestNumber: number;
  title: string;
  stage: LoopStage;
  risk: RiskClass[];
  level: AutonomyLevel;
  summary: string;
  conversation: Message[];
  before: { title: string; meta: string; lines: FolioLine[]; total: string };
  after: { title: string; meta: string; lines: FolioLine[]; total: string };
  alsoChanges: string[];
  unchanged: string[];
  designDoc?: string;
  evidence: EvidenceItem[];
  checklist: ChecklistStep[];
  approvals: { by: string; role: Role; at: string }[];
  engineer: { pr: string; branch: string; files: string[]; stats: string; preview: string; models: string };
};

export type Gate = "try" | "owner-approval" | "data-preview";

// ── Bridge ────────────────────────────────────────────────────────────────
export type Severity = "good" | "warn" | "bad" | "info";

export type Signal = { id: string; severity: Severity; title: string; detail: string };

export type NeedsYou = {
  id: string;
  kind: "try" | "decide" | "approve" | "ship";
  title: string;
  detail: string;
  href?: string;
  options?: string[];
};

export type Gauges = {
  health: number;
  healthNote: string;
  timeToLiveDays: number;
  timeToLiveNote: string;
  openRequests: number;
  openNote: string;
  quality: number;
  qualityNote: string;
  spendUsd: number;
  budgetUsd: number;
  spendNote: string;
};

export type Release = { id: string; at: string; title: string; detail: string; requestNumber?: number };

export type Bridge = {
  site: Site;
  gauges: Gauges;
  needsYou: NeedsYou[];
  signals: Signal[];
  inFlight: SiteRequest[];
  recentReleases: Release[];
};

// ── Data Desk ─────────────────────────────────────────────────────────────
export type DataInvestigation = {
  id: string;
  requestNumber: number;
  question: string;
  askedBy: string;
  findings: { text: string; flag: "warn" | "ok" }[];
  summary: string;
  proposedFix: { record: string; now: string; after: string }[];
  affects: string;
  status: "awaiting-approval" | "approved" | "kept";
  engineer: string;
};

export type DataCheck = { id: string; name: string; lastRun: string; result: "pass" | "warn" | "fail"; detail: string };

// ── Library ───────────────────────────────────────────────────────────────
export type DocKind = "rulebook" | "decision" | "design" | "requirements" | "runbook" | "release-notes";

export type Doc = {
  id: string;
  kind: DocKind;
  title: string;
  status: "draft" | "approved" | "living";
  updatedAt: string;
  source: string;
  sections: { heading: string; body: string }[];
};

export type Fact = { name: string; value: string; conflict?: string };

export type Drift = { id: string; docSays: string; siteDoes: string };

// ── Consultations (transcript → requirements → design → build) ────────────
export type ConsultationStage = "transcript" | "requirements" | "approved" | "design" | "building" | "live";

export type Consultation = {
  id: string;
  title: string;
  date: string;
  mode: "voice" | "meeting" | "chat";
  participants: string[];
  stage: ConsultationStage;
  transcriptExcerpt: { speaker: string; text: string }[];
  requirements: { id: string; text: string; confirmed: boolean }[];
  openQuestions: { q: string; answer?: string }[];
  designDoc?: string;
};

// ── Proof (testing) ───────────────────────────────────────────────────────
export type TestLayer = "types" | "lint" | "unit" | "domain-rules" | "journeys" | "visual" | "quality" | "data";

export type TestSuite = {
  id: string;
  layer: TestLayer;
  name: string;
  description: string;
  tests: number;
  passed: number;
  lastRun: string;
  durationSec: number;
  heldOut: boolean;
  writtenBy: "engine" | "human" | "judge";
};

export type SyntheticDataset = {
  id: string;
  name: string;
  mirrors: string;
  rows: number;
  refreshed: string;
  notes: string;
};

export type Proof = {
  verdict: "ready" | "needs-work";
  verdictNote: string;
  suites: TestSuite[];
  datasets: SyntheticDataset[];
  recentRuns: { at: string; change: string; result: "ready" | "needs-work"; detail: string }[];
};

// ── Health (Lighthouse + architecture vital signs) ────────────────────────
export type LighthouseScores = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  ranAt: string;
  source: "pagespeed" | "sample";
  page: string;
};

/** Critically ill → stabilizing → recovering → healthy. */
export type Triage = "critical" | "stabilizing" | "recovering" | "healthy";

export type VitalSign = {
  id: string;
  name: string;
  score: number;
  reading: string;
  explains: string;
  trend: number[];
};

export type Health = {
  lighthouse: LighthouseScores[];
  triage: Triage;
  triageNote: string;
  vitals: VitalSign[];
  hotspots: { path: string; why: string; changes90d: number }[];
  treatmentPlan: { phase: string; goal: string; status: "done" | "active" | "next" }[];
};

// ── Configuration (the env manifest) ──────────────────────────────────────
export type Environment = "development" | "preview" | "production";

export type EnvStatus = "set" | "missing" | "not-needed" | "stale";

/** One key the site needs. Values are never stored here — only whether each environment has one. */
export type EnvVarSpec = {
  key: string;
  service: string;
  purpose: string;
  secret: boolean;
  requiredBy: string[];
  environments: Record<Environment, EnvStatus>;
  lastVerified: string | null;
  howToGet: string;
};

export type Connection = {
  id: string;
  name: string;
  status: "connected" | "warning" | "missing";
  detail: string;
  lastTested: string;
};

export type Configuration = {
  env: EnvVarSpec[];
  connections: Connection[];
  rolePermissions: { role: string; code: string; testData: string; liveData: string; goLive: string; money: string }[];
  members: Member[];
};

// ── Skills registry ───────────────────────────────────────────────────────
export type Skill = {
  id: string;
  name: string;
  category: "engineering" | "design" | "content" | "data" | "testing" | "operations" | "consulting";
  description: string;
  source: "strategic-machines" | "custom";
  version: string;
  enabled: boolean;
  usedBy: string[];
};

// ── Account (subscription, payment, meters) ───────────────────────────────
export type PlanId = "commission" | "operate" | "managed";

export type UsageMeter = {
  provider: string;
  model: string;
  role: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  limitUsd: number;
};

export type Account = {
  org: Org;
  plan: { id: PlanId; name: string; monthlyUsd: number; installFeeUsd: number; installPaid: boolean; renewsOn: string };
  card: { brand: string; last4: string; expires: string } | null;
  invoices: { id: string; date: string; description: string; amountUsd: number; status: "paid" | "due" }[];
  meters: UsageMeter[];
  dailyCapUsd: number;
  monthToDateUsd: number;
};

// ── Code (Engineer view) ──────────────────────────────────────────────────
export type FileNode = { name: string; path: string; type: "dir" | "file"; children?: FileNode[] };
