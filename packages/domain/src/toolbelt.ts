import type { ModelRole } from "./flywheel";

/**
 * The Toolbelt v0 (gen2-crew.md §1.2, G2.2): the tools agents reach over MCP,
 * served by the API. A specialist *is* its tool list: tools/list shows only
 * what its role may use, and the same allowlist is enforced again on every
 * call (§10.5: on invocation, not only discovery). The tenant comes from the
 * job token, never from input (§0 rule 2): no tool takes a site or work id.
 *
 * v0 is deliberately read-and-report: status, history, decisions, evidence,
 * the census, and a note on the rail. Writing code stays in the runner's
 * worktree; releasing stays a person's decision (or the Low-tier policy) in the
 * API. No release or merge tool exists for any agent.
 *
 * G2.2b: tools are disclosed by stage (a tool appears only at the rail stops
 * where it helps), and a site's crew can narrow a specialist's tools; both
 * travel in the job token and are enforced on every call.
 */

export type ToolRisk = "read" | "report";

export type ToolSpec = {
  name: string;
  description: string;
  risk: ToolRisk;
  roles: readonly ModelRole[];
  /** The rail stops where the tool is listed (progressive disclosure); missing means every stop. */
  stages?: readonly string[];
  inputSchema: Record<string, unknown>;
};

const ALL: readonly ModelRole[] = ["consult", "design", "plan", "build", "judge"];
const none = { type: "object", properties: {}, additionalProperties: false };

export const TOOLBELT: readonly ToolSpec[] = [
  {
    name: "work_status",
    description: "Where this Work item stands: tier, milestones, the decision waiting on the person, steps and the latest proof.",
    risk: "read",
    roles: ALL,
    inputSchema: none,
  },
  {
    name: "work_history",
    description: "This Work item's timeline from the Change Ledger: decisions, check runs, repairs and escalations, newest last.",
    risk: "read",
    roles: ALL,
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false },
  },
  {
    name: "work_decisions",
    description: "The decisions recorded on this Work item: who decided what, on which version or candidate, and any that were voided and why.",
    risk: "read",
    roles: ALL,
    inputSchema: none,
  },
  {
    name: "evidence_recent",
    description: "The latest check runs on this Work item (step checks, Prove, release, code census) with their results and commits.",
    risk: "read",
    roles: ALL,
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["step_checks", "prove", "release", "census"] } }, additionalProperties: false },
  },
  {
    name: "site_census",
    description: "The site's latest code census: functions, components, routes, files, lines and the most branching files.",
    risk: "read",
    roles: ALL,
    inputSchema: none,
  },
  {
    name: "site_capabilities",
    description: "The site's accepted capability inventory: each business capability, its importance, requirements and the repository paths that implement it.",
    risk: "read",
    roles: ALL,
    inputSchema: none,
  },
  {
    name: "stripe_test_catalog",
    description: "Read the site's Stripe catalog in TEST MODE only (products or prices), to ground payment and pricing work in real test data. Refuses any live key.",
    risk: "read",
    roles: ["design", "plan", "build"],
    stages: ["design", "plan", "build", "prove"],
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["products", "prices"] }, limit: { type: "integer", minimum: 1, maximum: 50 } },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    name: "rail_note",
    description:
      "Post a short note from your role into this Work item's conversation, for things the person should know now (a finding, a risk, a question). Not for progress chatter.",
    risk: "report",
    roles: ["design", "plan", "build", "judge"],
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", minLength: 1, maxLength: 1200 } },
      required: ["note"],
      additionalProperties: false,
    },
  },
];

/** What narrows a role's tools for one job: the rail stop it runs at, and the site crew's allowance. */
export type ToolScope = { stage?: string | null; allowed?: readonly string[] | null };

const fits = (t: ToolSpec, role: ModelRole, scope: ToolScope = {}) =>
  t.roles.includes(role) && (!t.stages || !scope.stage || t.stages.includes(scope.stage)) && (!scope.allowed || scope.allowed.includes(t.name));

/** The tools a role may see and call, at this stop, within the site crew's allowance. */
export const toolsFor = (role: ModelRole, scope?: ToolScope) => TOOLBELT.filter((t) => fits(t, role, scope));

/** Whether a role may call a tool: checked on every invocation, whatever was listed. */
export const mayCall = (role: ModelRole, tool: string, scope?: ToolScope) => TOOLBELT.some((t) => t.name === tool && fits(t, role, scope));

/** Only a Stripe test-mode key may be used by any tool. */
export const isStripeTestKey = (key: string | undefined | null) => !!key && /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key.trim());

/** What a job token binds (§1.2 change 1): one job, its tenant and its role, until it expires. */
export type JobTokenClaims = {
  jobId: string;
  orgId: string;
  siteId: string;
  workId: string | null;
  role: ModelRole;
  /** The claim generation this token was minted for (§14.1): a superseded worker's token stops working. */
  generation: number;
  /** Expiry, epoch milliseconds. */
  exp: number;
  /** The rail stop the job runs at (progressive disclosure). */
  stage?: string | null;
  /** The site crew's tool allowance for this specialist; missing means the role's full list. */
  tools?: string[] | null;
};

/** The crew role a model setting speaks as, in notes and the audit. */
export const ROLE_VOICE: Record<ModelRole, string> = { consult: "Team Lead", design: "Designer", plan: "Planner", build: "Builder", judge: "Judge" };
