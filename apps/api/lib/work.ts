import {
  workClosureCopy,
  agreementText,
  autoAction,
  canApprove,
  canSite,
  MAX_PROOF_REPAIRS,
  MAX_STEP_REPAIRS,
  pendingDecision,
  readCensus,
  readIntent,
  canSetComplexity,
  COMPLEXITY_LABEL,
  complexityFloor,
  effectiveComplexity,
  escalation,
  higherOf,
  isComplexity,
  isDomain,
  protocolVerdict,
  proveVerdict,
  releaseVerdict,
  resolveModels,
  SETUP_TEMPLATE,
  setupDone,
  stageFor,
  validateModels,
  workActions,
  modelLabel,
  type Assessment,
  type Census,
  type Complexity,
  type Domain,
  type Identity,
  type Job,
  type PendingDecision,
  type JobContext,
  type JobEvent,
  type JobKind,
  type ModelRole,
  type ProveEvidence,
  type ProveFacts,
  type ReleaseEvidence,
  type RiskClass,
  type Role,
  type Site,
  type SiteModel,
  type SiteSetup,
  type StepChecks,
  type WorkDetail,
  type WorkDoc,
  type WorkItem,
  type WorkMessage,
  type WorkStep,
} from "@accelerator/domain";

import { CodeError } from "./codes";
import { CREW_ROLE, decide, evidence, invalidate, record, type Actor } from "./ledger";
import { db, rows, type Row } from "./supabase";
import { secretStatus } from "./vault";

/**
 * The Flywheel on the server (work/flywheel.md). The API owns the rail:
 * people act through the routes, the runner reports results through
 * applyResult, and every change recomputes the stage from what exists.
 */

const now = () => new Date().toISOString();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "work";

// ── Row → shape ──────────────────────────────────────────────────────────────
const toWork = (r: Row): WorkItem => ({
  id: r.id as string,
  number: r.number as number,
  kind: ((r.kind as string) ?? "change") as WorkItem["kind"],
  title: r.title as string,
  stage: r.stage as WorkItem["stage"],
  risk: (r.risk as RiskClass[]) ?? [],
  complexity: effectiveComplexity(isComplexity(r.complexity) ? r.complexity : "medium", (r.risk as RiskClass[]) ?? []),
  recommendedComplexity: isComplexity(r.recommended_complexity) ? r.recommended_complexity : null,
  complexityReason: (r.complexity_reason as string) ?? null,
  complexitySetBy: r.complexity_set_by === "person" ? "person" : "platform",
  ready: !!r.ready_at,
  autoShip: !!r.auto_ship,
  paused: !!r.paused_at,
  proofRepairs: (r.proof_repairs as number) ?? 0,
  branch: (r.branch as string) ?? null,
  planApproved: !!r.plan_approved_at,
  previewUrl: (r.preview_url as string) ?? null,
  proof: (r.proof as ProveEvidence) ?? null,
  tryApproved: !!r.try_approved_at,
  released: !!r.released_at,
  release: (r.release as ReleaseEvidence) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
const toMessage = (r: Row): WorkMessage => ({
  id: r.id as string,
  authorKind: r.author_kind as WorkMessage["authorKind"],
  authorLabel: r.author_label as string,
  model: (r.model as string) ?? null,
  stage: r.stage as string,
  body: r.body as string,
  createdAt: r.created_at as string,
});
const toDoc = (r: Row): WorkDoc => ({
  id: r.id as string,
  version: r.version as number,
  body: r.body as string,
  authorLabel: r.author_label as string,
  model: (r.model as string) ?? null,
  approvedAt: (r.approved_at as string) ?? null,
  createdAt: r.created_at as string,
});
const toStep = (r: Row): WorkStep => ({
  id: r.id as string,
  position: r.position as number,
  title: r.title as string,
  detail: r.detail as string,
  status: r.status as WorkStep["status"],
  attempts: (r.attempts as number) ?? 0,
  evidence: (r.evidence as WorkStep["evidence"]) ?? {},
});
const toJob = (r: Row): Job => ({
  id: r.id as string,
  kind: r.kind as JobKind,
  status: r.status as Job["status"],
  provider: r.provider as string,
  model: r.model as string,
  error: (r.error as string) ?? null,
  createdAt: r.created_at as string,
  startedAt: (r.started_at as string) ?? null,
  finishedAt: (r.finished_at as string) ?? null,
});

// ── Models per site (F15) ────────────────────────────────────────────────────
export async function siteModels(siteId: string) {
  const saved = await rows(db().from("acc_site_models").select("role, provider, model, key_source").eq("site_id", siteId));
  return resolveModels(saved.map((m) => ({ role: m.role, provider: m.provider, model: m.model, keySource: m.key_source }) as SiteModel));
}

export async function saveModels(site: Site, models: SiteModel[]) {
  const problems = validateModels(Object.values(resolveModels(models)));
  if (problems.length) throw new CodeError(problems.join(" "));
  const { error } = await db()
    .from("acc_site_models")
    .upsert(models.map((m) => ({ site_id: site.id, org_id: site.orgId, role: m.role, provider: m.provider, model: m.model.trim(), key_source: m.keySource, updated_at: now() })));
  if (error) throw new Error(error.message);
}

// ── Reads ────────────────────────────────────────────────────────────────────
export async function listWork(siteId: string): Promise<WorkItem[]> {
  return (await rows(db().from("acc_work").select("*").eq("site_id", siteId).order("number", { ascending: false }))).map(toWork);
}

async function workRow(siteId: string, number: number): Promise<Row> {
  const [w] = await rows(db().from("acc_work").select("*").eq("site_id", siteId).eq("number", number));
  if (!w) throw new CodeError("That work item doesn't exist.");
  return w;
}

async function parts(workId: string) {
  const [messages, designs, steps, jobs] = await Promise.all([
    rows(db().from("acc_work_messages").select("*").eq("work_id", workId).order("created_at")),
    rows(db().from("acc_work_docs").select("*").eq("work_id", workId).order("version")),
    rows(db().from("acc_work_steps").select("*").eq("work_id", workId).order("position")),
    rows(db().from("acc_jobs").select("*").eq("work_id", workId).order("created_at", { ascending: false }).limit(20)),
  ]);
  return { messages: messages.map(toMessage), designs: designs.map(toDoc), steps: steps.map(toStep), jobs: jobs.map(toJob) };
}

const facts = (w: WorkItem, p: Awaited<ReturnType<typeof parts>>) => {
  const latest = p.designs.at(-1);
  return {
    stage: w.stage,
    risk: w.risk,
    complexity: w.complexity,
    ready: w.ready,
    autoShip: w.autoShip,
    paused: w.paused,
    proofRepairs: w.proofRepairs,
    jobRunning: p.jobs.some((j) => j.status === "queued" || j.status === "running"),
    latestDesign: latest ? { version: latest.version, approved: !!latest.approvedAt } : null,
    planApproved: w.planApproved,
    steps: p.steps,
    proven: w.proof?.ok === true,
    proofFailed: !!w.proof && !w.proof.ok,
    tryApproved: w.tryApproved,
    released: w.released,
  };
};

/** New or rebuilt steps make the last Prove, preview and Try approval stale. */
const UNPROVEN = { preview_url: null, proven_at: null, proof: null, try_approved_at: null, try_approved_by: null };

export async function runnerOnline() {
  const since = new Date(Date.now() - 30_000).toISOString();
  return (await rows(db().from("acc_runners").select("id").gte("last_seen", since).limit(1))).length > 0;
}

export async function workDetail(site: Site, number: number): Promise<WorkDetail> {
  const work = toWork(await workRow(site.id, number));
  const p = await parts(work.id);
  const [events, models, online] = await Promise.all([
    p.jobs[0] ? rows(db().from("acc_job_events").select("id, at, kind, text").eq("job_id", p.jobs[0].id).order("id").limit(400)) : Promise.resolve([]),
    siteModels(site.id),
    runnerOnline(),
  ]);
  const f = facts(work, p);
  const actions = workActions(f);
  return {
    work, ...p, events: events as unknown as JobEvent[], actions, crewNext: work.kind === "change" ? autoAction(f) : null,
    decision: work.kind === "change" ? decisionFor(work, p, actions) : null, models, runnerOnline: online,
  };
}

/**
 * The decision waiting on a person for each active change item, and since when
 * (the item's last change). Shared by the briefing and the Cockpit Dial so
 * both count the same thing.
 */
export async function pendingDecisions(items: WorkItem[]): Promise<{ number: number; title: string; work: string; since: string }[]> {
  const active = items.filter((w) => w.kind === "change" && w.stage !== "done" && w.stage !== "cancelled");
  const found = await Promise.all(
    active.map(async (w) => {
      const p = await parts(w.id);
      const pd = decisionFor(w, p, workActions(facts(w, p)));
      return pd ? { number: w.number, title: pd.title, work: w.title, since: w.updatedAt } : null;
    }),
  );
  return found.filter((x): x is NonNullable<typeof x> => !!x);
}

/** The one governance decision pending now, bound to the exact version or candidate (gen2-crew.md §17.4). */
function decisionFor(work: WorkItem, p: Awaited<ReturnType<typeof parts>>, actions: ReturnType<typeof workActions>): PendingDecision | null {
  return pendingDecision({ complexity: work.complexity, risk: work.risk, latestDesignVersion: p.designs.at(-1)?.version ?? null, candidate: work.proof?.commit ?? null, actions });
}

// ── Writes by people ─────────────────────────────────────────────────────────
async function say(w: Row, m: { kind: WorkMessage["authorKind"]; label: string; body: string; userId?: string; model?: string }) {
  const { error } = await db().from("acc_work_messages").insert({
    org_id: w.org_id, work_id: w.id, author_kind: m.kind, author_label: m.label, author_user_id: m.userId ?? null, model: m.model ?? null, stage: w.stage, body: m.body,
  });
  if (error) throw new Error(error.message);
}

/** Recompute the rail from what exists (never set by hand). */
async function restage(workId: string) {
  const [w] = await rows(db().from("acc_work").select("*").eq("id", workId));
  if (!w || w.stage === "done" || w.stage === "cancelled") return;
  const work = toWork(w);
  const p = await parts(workId);
  const { stage: _stage, jobRunning: _running, ...f } = facts(work, p);
  const stage = stageFor(f);
  await db().from("acc_work").update({ stage, updated_at: now() }).eq("id", workId);
}

async function enqueue(site: Pick<Site, "id" | "orgId">, work: Row | null, kind: JobKind, role: ModelRole, userId: string, input: Record<string, unknown> = {}) {
  if (work) {
    const busy = await rows(db().from("acc_jobs").select("id").eq("work_id", work.id as string).in("status", ["queued", "running"]).limit(1));
    if (busy.length) throw new CodeError("The engine is already working on this. Wait for it to finish.");
  }
  const m = (await siteModels(site.id))[role];
  const { error } = await db().from("acc_jobs").insert({
    org_id: site.orgId, site_id: site.id, work_id: work?.id ?? null, kind, role, provider: m.provider, model: m.model, input, created_by: userId,
  });
  if (error) throw new Error(error.message);
}

const personLabel = (identity: Identity, name?: string) => name || identity.email.split("@")[0]!;
type Via = "button" | "typed";
const person = (identity: Identity, name: string, role: Role | null = null, via: Via = "button") =>
  ({ kind: "person", userId: identity.userId, label: personLabel(identity, name), role, via }) as const;
const POLICY = (complexity: string) => ({ kind: "policy", label: complexity === "low" ? "Low-complexity policy" : "Standing approval" }) as const;
const proofCommit = (w: Row) => ((w.proof as ProveEvidence | null)?.commit ?? null) as string | null;

export async function createWork(site: Site, identity: Identity, name: string, input: { title: string; message: string; risk: RiskClass[] }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [top] = await rows(db().from("acc_work").select("number").eq("site_id", site.id).order("number", { ascending: false }).limit(1));
    const number = ((top?.number as number) ?? 0) + 1;
    const { data, error } = await db()
      .from("acc_work")
      .insert({
        org_id: site.orgId, site_id: site.id, number, title: input.title.trim(), risk: input.risk,
        complexity: higherOf("medium", complexityFloor(input.risk)),
        branch: `work/${number}-${slug(input.title)}`, navigator_id: identity.userId, created_by: identity.userId,
      })
      .select("*")
      .single();
    if (error?.code === "23505") continue; // number taken by a concurrent create; take the next
    if (error) throw new Error(error.message);
    await say(data, { kind: "person", label: personLabel(identity, name), userId: identity.userId, body: input.message.trim() });
    await enqueue(site, data, "discuss", "consult", identity.userId);
    return { number };
  }
  throw new Error("Couldn't number the work item.");
}

/** The site's installation conversation (one per site): the engine sees Setup, the checkout log and which keys are set. */
export async function installConversation(site: Site, identity: Identity, name: string) {
  const [existing] = await rows(db().from("acc_work").select("number").eq("site_id", site.id).eq("kind", "install").neq("stage", "cancelled").limit(1));
  if (existing) return { number: existing.number as number };
  for (let attempt = 0; attempt < 2; attempt++) {
    const [top] = await rows(db().from("acc_work").select("number").eq("site_id", site.id).order("number", { ascending: false }).limit(1));
    const number = ((top?.number as number) ?? 0) + 1;
    const { data, error } = await db()
      .from("acc_work")
      .insert({ org_id: site.orgId, site_id: site.id, number, kind: "install", title: "Installation", navigator_id: identity.userId, created_by: identity.userId })
      .select("*")
      .single();
    if (error?.code === "23505") continue;
    if (error) throw new Error(error.message);
    await say(data, {
      kind: "system",
      label: "Control Room",
      body: `${personLabel(identity, name)} opened the installation conversation. Ask about anything on the Setup page: a failed check, a missing key, access the engine doesn't have.`,
    });
    return { number };
  }
  throw new Error("Couldn't open the installation conversation.");
}

/** Terminal records remain inspectable; new scope starts a separate governed Work item. */
function assertOpen(w: Row) {
  if (w.stage === "done" || w.stage === "cancelled") throw new CodeError("This work item is closed. Start another improvement for new design work.");
}
function assertDesignOpen(w: Row) {
  assertOpen(w);
  if (w.released_at) throw new CodeError("This work has a recorded release. Start another improvement for new design work.");
}

/** Who is speaking, for typed decisions: the same checks the decision buttons' routes make. */
export type Speaker = { name: string; role: Role; member: boolean };

/**
 * Say something in the thread. A short, exact "approve" / "ship it" answers
 * the pending decision the person was shown (`shown`, its key); "stop" pauses
 * the crew and "resume" restarts it (gen2-crew.md §17.4). Anything else goes to
 * the lead, who answers before the crew goes on.
 */
export async function postMessage(site: Site, identity: Identity, who: Speaker, number: number, body: string, shown?: string) {
  const w = await workRow(site.id, number);
  assertOpen(w);
  await say(w, { kind: "person", label: personLabel(identity, who.name), userId: identity.userId, body: body.trim() });
  const intent = w.kind === "change" ? readIntent(body) : null;
  if (intent === "pause") return pauseWork(site, identity, who.name, number);
  if (intent === "resume") return resumeWork(site, identity, who.name, number);
  if (intent === "approve" && (await typedDecision(site, identity, who, w, shown))) return;
  // While the crew is working, the message waits: drive() has the lead answer it before the crew goes on.
  if (await busy(w.id as string)) return;
  await enqueue(site, w, "discuss", "consult", identity.userId);
}

/** A typed approval, resolved exactly like its button, or refused with the reason. False when nothing is pending. */
async function typedDecision(site: Site, identity: Identity, who: Speaker, w: Row, shown?: string): Promise<boolean> {
  const p = await parts(w.id as string);
  const work = toWork(w);
  const pd = decisionFor(work, p, workActions(facts(work, p)));
  if (!pd) return false;
  const refuse = async (body: string) => (await say(w, { kind: "system", label: "Control Room", body }), true);
  if (!shown || shown !== pd.key) return refuse(`Not applied: what's waiting now is "${pd.title}", which may have changed since you looked. Review it, then approve.`);
  if (pd.ownerOnly) return refuse(`"${pd.title}" touches ${work.risk.join(", ")}, so it needs the ${pd.action} button and a confirmation, not a typed reply.`);
  if (!who.member) return refuse("The Navigator decides; partner staff can discuss and draft.");
  if (!canSite(who.role, "change.approve")) return refuse("Your role can't make this decision. Ask an Owner or Operator.");
  if (pd.needsRelease && !canSite(who.role, "release.ship")) return refuse("Your role can't release to production. Ask an Owner or Operator.");
  try {
    const n = work.number;
    if (pd.kind === "approve_brief" || pd.kind === "approve_design") await approveDesign(site, identity, who.name, n, p.designs.at(-1)!.version, "typed");
    else if (pd.kind === "approve_plan") await approvePlan(site, identity, who.name, n, "typed");
    else if (pd.kind === "approve_try") await approveTry(site, identity, who.name, who.role, n, "typed");
    else if (pd.kind === "ship") await shipWork(site, identity, who.name, who.role, n, "typed");
    else if (pd.kind === "release") await releaseWork(site, identity, who.name, n, "typed");
    else await closeWork(site, identity, who.name, n, "typed");
  } catch (err) {
    if (err instanceof CodeError) return refuse(err.message);
    throw err;
  }
  return true;
}

/** A finished voice call's transcript, as one message in the item's conversation (gen2-crew.md §19.1). */
export async function recordVoiceCall(site: Site, identity: Identity, name: string, number: number, body: string, seconds: number) {
  const w = await workRow(site.id, number);
  await say(w, { kind: "model", label: "Voice call", body: body.slice(0, 60_000) });
  await record(w, {
    kind: "voice_call", actor: person(identity, name),
    summary: `${personLabel(identity, name)} talked with the Team Lead about #${number} for ${Math.max(1, Math.round(seconds / 60))} min.`,
  });
}

/** "Stop": nothing new starts until a person resumes; queued work is withdrawn, running work finishes. */
export async function pauseWork(site: Site, identity: Identity, name: string, number: number) {
  const w = await workRow(site.id, number);
  assertOpen(w);
  if (w.paused_at) return;
  await db().from("acc_work").update({ paused_at: now(), updated_at: now() }).eq("id", w.id as string);
  await db().from("acc_jobs").update({ status: "cancelled", finished_at: now(), error: "Paused by a person." }).eq("work_id", w.id as string).eq("status", "queued");
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} paused the crew. Nothing new starts until you say resume; anything already running finishes.` });
  await decide(w, { kind: "pause", actor: person(identity, name), summary: `${personLabel(identity, name)} paused the crew on #${number}.` });
}

export async function resumeWork(site: Site, identity: Identity, name: string, number: number) {
  const w = await workRow(site.id, number);
  assertOpen(w);
  if (!w.paused_at) return;
  await db().from("acc_work").update({ paused_at: null, updated_at: now() }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} resumed the crew.` });
  await decide(w, { kind: "resume", actor: person(identity, name), summary: `${personLabel(identity, name)} resumed the crew on #${number}.` });
  await drive(site, w.id as string, identity.userId);
}

export async function draftDesign(site: Site, identity: Identity, number: number, note?: string) {
  const w = await workRow(site.id, number);
  assertDesignOpen(w);
  await enqueue(site, w, "design", "design", identity.userId, note ? { note } : {});
}

/** The Navigator edits design.md: a new version, authored by them (unapproved). */
export async function saveDesign(site: Site, identity: Identity, name: string, number: number, body: string) {
  const w = await workRow(site.id, number);
  assertDesignOpen(w);
  const [top] = await rows(db().from("acc_work_docs").select("version").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
  const version = ((top?.version as number) ?? 0) + 1;
  const { error } = await db().from("acc_work_docs").insert({ org_id: w.org_id, work_id: w.id, version, body, author_label: personLabel(identity, name) });
  if (error) throw new Error(error.message);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} edited the design (v${version}).` });
  // A changed design invalidates an approved plan.
  await db().from("acc_work").update({ plan_approved_at: null, plan_approved_by: null }).eq("id", w.id as string);
  await record(w, { kind: "drafted", actor: person(identity, name), summary: `${personLabel(identity, name)} edited the design (v${version}).`, refs: { document: "design", version } });
  await invalidate(w, ["approve_plan"], `the design was edited (v${version})`);
  await restage(w.id as string);
}

export async function approveDesign(site: Site, identity: Identity, name: string, number: number, version: number, via: Via = "button") {
  const w = await workRow(site.id, number);
  const [top] = await rows(db().from("acc_work_docs").select("id, version").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
  if (!top || top.version !== version) throw new CodeError("There's a newer version of the design. Review that one first.");
  await db().from("acc_work_docs").update({ approved_by: identity.userId, approved_at: now() }).eq("id", top.id as string);
  const what = toWork(w).complexity === "medium" ? "the Brief" : "design";
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} approved ${what} v${version}.` });
  const brief = what === "the Brief";
  await decide(w, { kind: brief ? "approve_brief" : "approve_design", actor: person(identity, name, null, via), target: `${brief ? "brief" : "design"} v${version}`, summary: `${personLabel(identity, name)} approved ${what} v${version}.` });
  await restage(w.id as string);
  await drive(site, w.id as string, identity.userId);
}

export async function draftPlan(site: Site, identity: Identity, number: number, note?: string) {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  if (!p.designs.at(-1)?.approvedAt) throw new CodeError("Approve the design first; the plan is built from it.");
  await enqueue(site, w, "plan", "plan", identity.userId, note ? { note } : {});
}

export async function approvePlan(site: Site, identity: Identity, name: string, number: number, via: Via = "button") {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  if (!workActions(facts(toWork(w), p)).approvePlan) throw new CodeError("There's no plan ready to approve.");
  await db().from("acc_work").update({ plan_approved_at: now(), plan_approved_by: identity.userId }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} approved the plan (${p.steps.length} steps). The crew builds it now.` });
  await decide(w, { kind: "approve_plan", actor: person(identity, name, null, via), target: `plan of ${p.steps.length} steps`, summary: `${personLabel(identity, name)} approved the plan (${p.steps.length} steps).` });
  await restage(w.id as string);
  await drive(site, w.id as string, identity.userId);
}

/** Retry a step the Protocol blocked. Steps otherwise run on their own. */
export async function runNextStep(site: Site, identity: Identity, number: number) {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  const a = workActions(facts(toWork(w), p));
  if (!a.runNextStep || a.nextStep == null) throw new CodeError("There's no blocked step to run again.");
  const step = p.steps[a.nextStep]!;
  await enqueue(site, w, "build_step", "build", identity.userId, { stepId: step.id, repairReasons: step.evidence.reasons ?? [] });
  await record(w, { kind: "retry", actor: person(identity, personLabel(identity)), summary: `Step ${step.position} run again by ${personLabel(identity)}.`, refs: { step: step.id } });
}

// ── Prove · Try · Release · Close (flywheel.md F14) ─────────────────────────
async function actionsFor(site: Site, number: number) {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  return { w, p, a: workActions(facts(toWork(w), p)) };
}

/** Every step is built: run the full checks, push the branch, find its preview. */
export async function proveWork(site: Site, identity: Identity, number: number) {
  const { w, a } = await actionsFor(site, number);
  if (!a.prove) throw new CodeError("Prove runs on its own once every step is built; this retries a failed Prove.");
  await enqueue(site, w, "prove", "build", identity.userId);
}

/** Gate 3: the Navigator tried the preview and approves it for release. Risky changes need the Owner. */
export async function approveTry(site: Site, identity: Identity, name: string, role: Role, number: number, via: Via = "button") {
  const { w, a } = await actionsFor(site, number);
  if (!a.approveTry) throw new CodeError("There's no proven preview to approve yet.");
  if (!canApprove(role, (w.risk as RiskClass[]) ?? [])) throw new CodeError("This touches money, data, auth or security, so the site Owner approves it.");
  await db().from("acc_work").update({ try_approved_at: now(), try_approved_by: identity.userId }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} tried the preview and approved it for release.` });
  await decide(w, { kind: "approve_try", actor: person(identity, name, role, via), target: proofCommit(w), summary: `${personLabel(identity, name)} approved the preview for release.` });
  await restage(w.id as string);
}

/** Go live: merge to stage, move main to stage, check the live site. */
export async function releaseWork(site: Site, identity: Identity, name: string, number: number, via: Via = "button") {
  const { w, a } = await actionsFor(site, number);
  if (!a.release) throw new CodeError("Release needs a proven preview that has been tried and approved.");
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} pressed Go live.` });
  await decide(w, { kind: "release", actor: person(identity, name, null, via), target: proofCommit(w), summary: `${personLabel(identity, name)} released #${number} to production.` });
  await enqueue(site, w, "release", "build", identity.userId);
}

/** Live and checked: close the item (Learn feeds the next conversation). */
export async function closeWork(site: Site, identity: Identity, name: string, number: number, via: Via = "button") {
  const { w, a } = await actionsFor(site, number);
  if (!a.close) throw new CodeError("Close a work item once it's live.");
  const { error } = await db().from("acc_work").update({ stage: "done", updated_at: now() }).eq("id", w.id as string);
  if (error) throw new Error(error.message);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} ${workClosureCopy({ number, released: true }).receipt}` });
  await decide(w, { kind: "close", actor: person(identity, name, null, via), summary: `${personLabel(identity, name)} closed #${number} after release.` });
}

/**
 * Close tracking without a recorded platform release (internal status: cancelled). Code, branch and history stay.
 * The account's own people can close any item; partner staff only the items they started.
 */
export async function cancelWork(site: Site, identity: Identity, name: string, number: number, member: boolean) {
  const { w, a } = await actionsFor(site, number);
  if (!member && w.created_by !== identity.userId) throw new CodeError("Only the account's own people can close an item someone else started.");
  if (!a.cancel) throw new CodeError(toWork(w).released ? "This is already live; close it instead." : "Wait for the engine to finish, then close it.");
  const { error } = await db().from("acc_work").update({ stage: "cancelled", updated_at: now() }).eq("id", w.id as string);
  if (error) throw new Error(error.message);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} ${workClosureCopy({ number, released: false }).receipt}` });
  await decide(w, { kind: "cancel", actor: person(identity, name), summary: `${personLabel(identity, name)} closed #${number} without a platform release.` });
}

// ── Complexity tiers (gen2-crew.md §17) ──────────────────────────────────────
/** Medium's one release decision, "Ship it": approves the proven preview and releases it. */
export async function shipWork(site: Site, identity: Identity, name: string, role: Role, number: number, via: Via = "button") {
  const { w, a } = await actionsFor(site, number);
  if (!a.ship) throw new CodeError("There's no proven preview to ship yet.");
  if (!canApprove(role, (w.risk as RiskClass[]) ?? [])) throw new CodeError("This touches money, data, auth or security, so the site Owner approves it.");
  await db().from("acc_work").update({ try_approved_at: now(), try_approved_by: identity.userId }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} tried the preview and shipped it.` });
  await decide(w, { kind: "ship", actor: person(identity, name, role, via), target: proofCommit(w), summary: `${personLabel(identity, name)} shipped #${number}.` });
  await restage(w.id as string);
  await enqueue(site, w, "release", "build", identity.userId);
}

/** Low: start building now, without waiting for the lead to say it's ready. */
export async function beginWork(site: Site, identity: Identity, name: string, number: number) {
  const { w, a } = await actionsFor(site, number);
  if (!a.begin) throw new CodeError("This item can't start building from here.");
  await db().from("acc_work").update({ ready_at: now(), updated_at: now() }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} asked the crew to start.` });
  await decide(w, { kind: "begin", actor: person(identity, name), summary: `${personLabel(identity, name)} asked the crew to start #${number}.` });
  await drive(site, w.id as string, identity.userId);
}

/** A person sets the tier: anything at or above the risk floor. */
export async function setComplexity(site: Site, identity: Identity, name: string, number: number, complexity: Complexity) {
  const w = await workRow(site.id, number);
  assertOpen(w);
  if (w.released_at) throw new CodeError("This work is already released.");
  const risk = (w.risk as RiskClass[]) ?? [];
  if (!canSetComplexity(complexity, risk)) throw new CodeError(`This touches ${risk.join(", ")}, so it stays ${COMPLEXITY_LABEL[complexityFloor(risk)]} complexity.`);
  await db()
    .from("acc_work")
    .update({ complexity, complexity_set_by: "person", ...(complexity !== "medium" && { auto_ship: false }), updated_at: now() })
    .eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} set the complexity to ${COMPLEXITY_LABEL[complexity]}.` });
  await decide(w, { kind: "tier", actor: person(identity, name), target: complexity, summary: `${personLabel(identity, name)} set #${number} to ${COMPLEXITY_LABEL[complexity]} complexity.` });
  await drive(site, w.id as string, identity.userId);
}

/** Medium: ship automatically when proof is green (D44). */
export async function setAutoShip(site: Site, identity: Identity, name: string, number: number, on: boolean) {
  const w = await workRow(site.id, number);
  assertOpen(w);
  if (on && toWork(w).complexity !== "medium") throw new CodeError("Automatic shipping is only for Medium complexity.");
  await db().from("acc_work").update({ auto_ship: on, updated_at: now() }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} ${on ? "chose to ship automatically when proof is green" : "turned off automatic shipping"}.` });
  await decide(w, { kind: "auto_ship", actor: person(identity, name), target: on ? "on" : "off", summary: `${personLabel(identity, name)} turned ship-when-green ${on ? "on" : "off"} for #${number}.` });
  await drive(site, w.id as string, identity.userId);
}

const busy = async (workId: string) =>
  (await rows(db().from("acc_jobs").select("id").eq("work_id", workId).in("status", ["queued", "running"]).limit(1))).length > 0;

/**
 * The crew's own next move (autoAction), taken until it reaches a job to run
 * or a decision the tier keeps for a person. A person's unanswered message is
 * answered first, so the conversation never waits behind the build.
 */
async function drive(site: Pick<Site, "id" | "orgId">, workId: string, actorId: string) {
  for (let turn = 0; turn < 4; turn++) {
    const [w] = await rows(db().from("acc_work").select("*").eq("id", workId));
    if (!w || w.kind === "install" || w.stage === "done" || w.stage === "cancelled") return;
    const p = await parts(workId);
    const f = facts(toWork(w), p);
    if (f.jobRunning) return;
    // Unanswered: the person spoke after the lead's last reply was queued (build summaries don't count as replies).
    // Typed commands (approve, stop, resume) were applied or answered by the Control Room, not the lead.
    const asked = p.messages.filter((m) => m.authorKind === "person" && !readIntent(m.body)).at(-1);
    const replied = p.jobs.find((j) => j.kind === "discuss"); // newest first
    if (asked && (!replied || asked.createdAt > replied.createdAt)) return void (await enqueue(site, w, "discuss", "consult", actorId));
    const next = autoAction(f);
    if (!next) return;
    switch (next) {
      case "begin":
        await db().from("acc_work_steps").insert({
          org_id: w.org_id, work_id: w.id, position: 1, title: (w.title as string).slice(0, 200),
          detail: "Make the change agreed in the conversation, exactly as agreed. Add or update tests that prove it.",
        });
        await db().from("acc_work").update({ plan_approved_at: now(), plan_approved_by: null }).eq("id", workId);
        await say(w, { kind: "system", label: "Crew", body: "Low complexity: building it now. It ships on its own once every check passes." });
        await record(w, { kind: "started", actor: POLICY("low"), summary: `Low complexity: the crew started building #${w.number}.` });
        await restage(workId);
        continue;
      case "approve_plan":
        await db().from("acc_work").update({ plan_approved_at: now(), plan_approved_by: null }).eq("id", workId);
        await say(w, { kind: "system", label: "Crew", body: `The crew's plan has ${p.steps.filter((s) => s.status !== "done").length} steps. Building now; you'll see the preview when it's proven.` });
        await decide(w, { kind: "approve_plan", actor: { kind: "policy", label: "Medium: the plan is the crew's" }, target: `plan of ${p.steps.length} steps`, summary: `The crew accepted its own plan for #${w.number} under the approved Brief.` });
        await restage(workId);
        continue;
      case "repair_step": {
        // The Protocol blocked a step: run it again with what failed, within the budget (§14.3).
        const step = p.steps.find((s) => s.status === "blocked")!;
        const reasons = step.evidence.reasons ?? [];
        const repair = Math.max(step.attempts, 1);
        await say(w, {
          kind: "system", label: "Crew",
          body: `Step ${step.position} didn't pass its checks${reasons.length ? `: ${reasons.join(" ")}` : "."} The crew is fixing it (repair ${repair} of ${MAX_STEP_REPAIRS}).`,
        });
        await record(w, { kind: "repair", actor: { kind: "crew", label: "Builder" }, summary: `Repairing step ${step.position} of #${w.number} (repair ${repair} of ${MAX_STEP_REPAIRS}).`, refs: { step: step.id } });
        return void (await enqueue(site, w, "build_step", "build", actorId, { stepId: step.id, repairReasons: reasons }));
      }
      case "repair_proof": {
        // Prove failed: add one step that fixes what it found, then build and prove again (bounded).
        const reasons = toWork(w).proof?.reasons ?? [];
        const position = Math.max(0, ...p.steps.map((s) => s.position)) + 1;
        await db().from("acc_work_steps").insert({
          org_id: w.org_id, work_id: w.id, position, title: "Fix what Prove found",
          detail: `Prove failed:\n${reasons.map((r) => `- ${r}`).join("\n")}\nFix the cause within the agreed scope. Never weaken, skip or delete tests to pass.`,
        });
        await db().from("acc_work").update({ proof_repairs: toWork(w).proofRepairs + 1 }).eq("id", workId);
        await say(w, { kind: "system", label: "Crew", body: `Prove didn't pass${reasons.length ? `: ${reasons.join(" ")}` : "."} The crew is fixing it and will prove again (repair ${toWork(w).proofRepairs + 1} of ${MAX_PROOF_REPAIRS}).` });
        await record(w, { kind: "repair", actor: { kind: "crew", label: "Builder" }, summary: `Fixing what Prove found on #${w.number}.` });
        await restage(workId);
        continue;
      }
      case "design":
        return void (await enqueue(site, w, "design", "design", actorId));
      case "plan":
        return void (await enqueue(site, w, "plan", "plan", actorId));
      case "build_step":
        return void (await enqueue(site, w, "build_step", "build", actorId, { stepId: p.steps.find((s) => s.status === "todo")!.id }));
      case "prove":
        return void (await enqueue(site, w, "prove", "build", actorId));
      case "ship":
        await db().from("acc_work").update({ try_approved_at: now(), try_approved_by: null }).eq("id", workId);
        await say(w, {
          kind: "system", label: "Crew",
          body: `${toWork(w).complexity === "low" ? "Low complexity" : "Standing approval"}: every check in the TDD plane passed, so this ships now.`,
        });
        await decide(w, {
          kind: "ship", actor: POLICY(toWork(w).complexity), target: proofCommit(w),
          summary: `#${w.number} shipped under the ${toWork(w).complexity === "low" ? "Low-complexity policy" : "standing approval"}: every check passed.`,
          detail: { proof: toWork(w).proof },
        });
        await restage(workId);
        return void (await enqueue(site, w, "release", "build", actorId));
    }
  }
}

/** One more run of a step, with its new status (repairs are bounded by its run count). */
async function countAttempt(stepId: string, update: Row) {
  const [s] = await rows(db().from("acc_work_steps").select("attempts").eq("id", stepId));
  await db().from("acc_work_steps").update({ ...update, attempts: ((s?.attempts as number) ?? 0) + 1, updated_at: now() }).eq("id", stepId);
}

/** The lead's assessment sets the recommendation, and the tier unless a person chose one. */
async function applyAssessment(w: Row, a: Assessment) {
  const risk = (w.risk as RiskClass[]) ?? [];
  const update: Row = { recommended_complexity: a.complexity, complexity_reason: a.reason || null, updated_at: now() };
  if (w.complexity_set_by !== "person" && !w.plan_approved_at) update.complexity = effectiveComplexity(a.complexity, risk);
  if (a.ready && !w.ready_at) update.ready_at = now();
  await db().from("acc_work").update(update).eq("id", w.id as string);
}

// ── Setup: Install · Checkout · Agreement ────────────────────────────────────
export async function siteSetup(site: Site): Promise<SiteSetup> {
  const existing = await rows(db().from("acc_setup_items").select("*").eq("site_id", site.id));
  const missing = SETUP_TEMPLATE.filter((t) => !existing.some((e) => e.code === t.code));
  if (missing.length) {
    await db().from("acc_setup_items").insert(missing.map((t) => ({ org_id: site.orgId, site_id: site.id, code: t.code, phase: t.phase, title: t.title, owner: t.owner })));
  }
  const [items, [agreement], [s], online] = await Promise.all([
    rows(db().from("acc_setup_items").select("*").eq("site_id", site.id)),
    rows(db().from("acc_agreements").select("*").eq("site_id", site.id).order("version", { ascending: false }).limit(1)),
    rows(db().from("acc_sites").select("repo, repo_path, base_branch, stage_url, baseline_tests, domain").eq("id", site.id)),
    runnerOnline(),
  ]);
  const order = (code: string) => SETUP_TEMPLATE.findIndex((t) => t.code === code);
  const list = items
    .map((i) => ({
      code: i.code as string, phase: i.phase as "install" | "checkout", title: i.title as string, owner: i.owner as SiteSetup["items"][number]["owner"],
      status: i.status as SiteSetup["items"][number]["status"], note: (i.note as string) ?? null, evidence: (i.evidence as Record<string, unknown>) ?? {}, updatedAt: i.updated_at as string,
    }))
    .sort((a, b) => order(a.code) - order(b.code));
  const signed = !!agreement?.signed_at;
  return {
    items: list,
    agreement: agreement ? { version: agreement.version as number, body: agreement.body as string, signedAt: (agreement.signed_at as string) ?? null } : { version: 0, body: agreementText(site.name), signedAt: null },
    settings: {
      repo: (s?.repo as string) || null, repoPath: (s?.repo_path as string) ?? null, baseBranch: (s?.base_branch as string) ?? "stage", stageUrl: (s?.stage_url as string) ?? null,
      baselineTests: (s?.baseline_tests as number) ?? null, domain: isDomain(s?.domain) ? s.domain : null,
    },
    runnerOnline: online,
    ready: setupDone(list) && signed,
  };
}

export async function setSetupItem(site: Site, identity: Identity, code: string, status: SiteSetup["items"][number]["status"], note?: string) {
  const { error, count } = await db()
    .from("acc_setup_items")
    .update({ status, note: note ?? null, updated_by: identity.userId, updated_at: now() }, { count: "exact" })
    .eq("site_id", site.id)
    .eq("code", code);
  if (error) throw new Error(error.message);
  if (!count) throw new CodeError("Unknown checklist item.");
}

export async function saveSiteSettings(site: Site, input: { repo?: string | null; repoPath?: string | null; baseBranch?: string; stageUrl?: string | null; domain?: Domain | null }) {
  const { error } = await db()
    .from("acc_sites")
    .update({
      ...(input.repo !== undefined && { repo: input.repo?.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") ?? "" }),
      ...(input.repoPath !== undefined && { repo_path: input.repoPath?.trim() || null }),
      ...(input.baseBranch && { base_branch: input.baseBranch.trim() }),
      ...(input.stageUrl !== undefined && { stage_url: input.stageUrl?.trim() || null }),
      ...(input.domain !== undefined && { domain: input.domain }),
    })
    .eq("id", site.id);
  if (error) throw new Error(error.message);
}

export async function runCheckout(site: Site, identity: Identity) {
  const busy = await rows(db().from("acc_jobs").select("id").eq("site_id", site.id).eq("kind", "checkout").in("status", ["queued", "running"]).limit(1));
  if (busy.length) throw new CodeError("Checkout is already running.");
  await enqueue(site, null, "checkout", "build", identity.userId);
}

export async function signAgreement(site: Site, identity: Identity, body: string) {
  const [top] = await rows(db().from("acc_agreements").select("version").eq("site_id", site.id).order("version", { ascending: false }).limit(1));
  const { error } = await db().from("acc_agreements").insert({
    org_id: site.orgId, site_id: site.id, version: ((top?.version as number) ?? 0) + 1, body, signed_by: identity.userId, signed_at: now(),
  });
  if (error) throw new Error(error.message);
}

export async function latestCheckout(siteId: string) {
  const [job] = await rows(db().from("acc_jobs").select("*").eq("site_id", siteId).eq("kind", "checkout").order("created_at", { ascending: false }).limit(1));
  if (!job) return null;
  const events = await rows(db().from("acc_job_events").select("id, at, kind, text").eq("job_id", job.id as string).order("id").limit(400));
  return { job: toJob(job), events: events as unknown as JobEvent[] };
}

// ── The runner's side ────────────────────────────────────────────────────────
export async function heartbeat(runnerId: string, version?: string) {
  await db().from("acc_runners").upsert({ id: runnerId, last_seen: now(), version: version ?? null });
}

/** Oldest queued job, claimed atomically (status guard), with everything the runner needs. */
export async function claim(runnerId: string): Promise<JobContext | null> {
  const queued = await rows(db().from("acc_jobs").select("id").eq("status", "queued").order("created_at").limit(5));
  for (const q of queued) {
    const { data } = await db()
      .from("acc_jobs")
      .update({ status: "running", started_at: now(), runner_id: runnerId })
      .eq("id", q.id as string)
      .eq("status", "queued")
      .select("*");
    const job = data?.[0] as Row | undefined;
    if (!job) continue;
    if (job.kind === "build_step") {
      await db().from("acc_work_steps").update({ status: "running", updated_at: now() }).eq("id", (job.input as Row).stepId as string);
    }
    return context(job);
  }
  return null;
}

async function context(job: Row): Promise<JobContext> {
  const [s] = await rows(db().from("acc_sites").select("*").eq("id", job.site_id as string));
  let work: JobContext["work"] = null;
  if (job.work_id) {
    const [w] = await rows(db().from("acc_work").select("*").eq("id", job.work_id as string));
    const p = await parts(job.work_id as string);
    work = { ...toWork(w!), messages: p.messages, design: p.designs.at(-1) ?? null, steps: p.steps };
  }
  let setup: JobContext["setup"];
  if (work?.kind === "install") {
    const siteShape = { id: s!.id as string, orgId: s!.org_id as string, name: s!.name as string } as Site;
    const [st, checkout, keys] = await Promise.all([siteSetup(siteShape), latestCheckout(siteShape.id), secretStatus(siteShape.id)]);
    setup = {
      items: st.items.map(({ code, title, owner, status, note }) => ({ code, title, owner, status, note })),
      agreementSigned: !!st.agreement?.signedAt,
      settings: st.settings,
      checkoutLog: checkout ? checkout.events.slice(-80).map((e) => `[${e.kind}] ${e.text}`) : [],
      keysSet: keys.map((k) => `${k.environment}:${k.name}`),
      manifest: (await rows(db().from("acc_env_specs").select("key").eq("site_id", siteShape.id))).map((r) => r.key as string),
    };
  }
  return {
    job: { ...toJob(job), role: job.role as ModelRole, input: (job.input as Record<string, unknown>) ?? {} },
    site: {
      id: s!.id as string, slug: s!.slug as string, name: s!.name as string, url: s!.url as string, repoPath: (s!.repo_path as string) ?? null,
      baseBranch: (s!.base_branch as string) ?? "stage", stack: (s!.stack as string) ?? null, baselineTests: (s!.baseline_tests as number) ?? null,
      repo: (s!.repo as string) || null, domain: isDomain(s!.domain) ? s!.domain : null,
    },
    work,
    setup,
  };
}

export async function addEvents(jobId: string, events: { kind: JobEvent["kind"]; text: string; data?: unknown }[]) {
  if (!events.length) return;
  const { error } = await db().from("acc_job_events").insert(events.map((e) => ({ job_id: jobId, kind: e.kind, text: e.text.slice(0, 4000), data: e.data ?? null })));
  if (error) throw new Error(error.message);
}

export type JobResult =
  | { kind: "discuss"; reply: string; assessment?: Assessment }
  | { kind: "design"; body: string }
  | { kind: "plan"; steps: { title: string; detail: string }[]; summary?: string }
  | { kind: "build_step"; stepId: string; summary: string; checks: Omit<StepChecks, "baseline">; commit?: string; files?: string[] }
  | {
      kind: "checkout";
      items: { code: string; status: "done" | "failed" | "waiting"; note?: string; evidence?: Record<string, unknown> }[];
      baselineTests?: number;
      manifest?: { key: string; purpose: string; howToGet: string }[];
    }
  | { kind: "prove"; facts: Omit<ProveFacts, "baseline">; branch: string; commit: string | null; previewUrl: string | null; previewStatus: number | null; census?: Census }
  | { kind: "release"; stageCommit: string | null; mainCommit: string | null; productionState: string; liveUrl: string; liveStatus: number | null; reasons?: string[] };

/** The runner reports; the API decides what it means for the rail. */
export async function finish(jobId: string, outcome: { status: "done" | "failed"; result?: JobResult; error?: string }) {
  const [job] = await rows(db().from("acc_jobs").select("*").eq("id", jobId).eq("status", "running"));
  if (!job) throw new CodeError("That job isn't running.");
  const label = modelLabel(job.provider as string, job.model as string);
  const model = `${job.provider}/${job.model}`;
  const [w] = job.work_id ? await rows(db().from("acc_work").select("*").eq("id", job.work_id as string)) : [];

  if (outcome.status === "failed" || !outcome.result) {
    await db().from("acc_jobs").update({ status: "failed", error: outcome.error ?? "Failed.", finished_at: now() }).eq("id", jobId);
    if (w) {
      if (job.kind === "build_step") await countAttempt((job.input as Row).stepId as string, { status: "blocked" });
      await record(w, { kind: "failed", actor: { kind: "crew", label: CREW_ROLE[job.role as string] ?? "Crew" }, summary: `The ${String(job.kind).replace("_", " ")} run failed: ${(outcome.error ?? "unknown error").slice(0, 200)}`, refs: { job: jobId } });
      await say(w, { kind: "system", label: "Runner", body: `The ${String(job.kind).replace("_", " ")} run failed: ${outcome.error ?? "unknown error"}` });
    }
    return;
  }

  const r = outcome.result;
  if (w && r.kind === "discuss") {
    await say(w, { kind: "model", label, model, body: r.reply });
    if (r.assessment && w.kind === "change") {
      await applyAssessment(w, r.assessment);
      await record(w, { kind: "assessed", actor: { kind: "crew", label: "Team Lead" }, summary: `Rated ${COMPLEXITY_LABEL[r.assessment.complexity]} complexity${r.assessment.reason ? `: ${r.assessment.reason}` : "."}`, refs: { job: jobId } });
    }
  } else if (w && r.kind === "design") {
    const [top] = await rows(db().from("acc_work_docs").select("version").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
    const version = ((top?.version as number) ?? 0) + 1;
    await db().from("acc_work_docs").insert({ org_id: w.org_id, work_id: w.id, version, body: r.body, author_label: label, model });
    await db().from("acc_work").update({ plan_approved_at: null, plan_approved_by: null }).eq("id", w.id as string);
    const brief = toWork(w).complexity === "medium";
    await say(w, { kind: "model", label, model, body: brief ? `The Brief (v${version}) is ready. Approve it and the crew plans, builds and proves it on its own.` : `Design v${version} is ready for your review. Edit it, ask for changes, or approve it.` });
    await record(w, { kind: "drafted", actor: { kind: "crew", label: "Designer" }, summary: `${brief ? "Brief" : "Design"} v${version} drafted for #${w.number}.`, refs: { job: jobId, document: brief ? "brief" : "design", version } });
    await invalidate(w, ["approve_plan"], `a new ${brief ? "Brief" : "design"} (v${version}) was drafted`);
  } else if (w && r.kind === "plan") {
    await db().from("acc_work_steps").delete().eq("work_id", w.id as string).neq("status", "done");
    const done = (await rows(db().from("acc_work_steps").select("id").eq("work_id", w.id as string))).length;
    await db().from("acc_work_steps").insert(r.steps.map((s, i) => ({ org_id: w.org_id, work_id: w.id, position: done + i + 1, title: s.title, detail: s.detail })));
    await db().from("acc_work").update({ plan_approved_at: null, plan_approved_by: null, ...UNPROVEN }).eq("id", w.id as string);
    await record(w, { kind: "drafted", actor: { kind: "crew", label: "Planner" }, summary: `Plan of ${r.steps.length} steps drafted for #${w.number}.`, refs: { job: jobId } });
    await invalidate(w, ["approve_plan", "approve_try", "ship"], "a new plan was drafted");
    await say(w, { kind: "model", label, model, body: `${r.summary ? `${r.summary}\n\n` : ""}The plan has ${r.steps.length} steps. Review it, reorder or trim it by asking, then approve.` });
  } else if (w && r.kind === "build_step") {
    const [site] = await rows(db().from("acc_sites").select("baseline_tests").eq("id", job.site_id as string));
    const checks: StepChecks = { ...r.checks, baseline: (site?.baseline_tests as number) ?? null };
    const verdict = protocolVerdict(checks);
    await countAttempt(r.stepId, { status: verdict.ok ? "done" : "blocked", evidence: { summary: r.summary, reasons: verdict.reasons, checks, commit: r.commit, files: r.files } });
    await evidence(w, {
      kind: "step_checks", ok: verdict.ok, commit: r.commit ?? null, tests: checks.tests, jobId, stepId: r.stepId, actor: { kind: "crew", label: "Builder" },
      detail: { reasons: verdict.reasons, typecheck: checks.typecheck, testsBefore: checks.testsBefore, files: r.files ?? [] },
      summary: verdict.ok ? `Step built and checked: ${r.summary.split("\n")[0]!.slice(0, 160)}` : `Step blocked by the Protocol: ${verdict.reasons.join(" ")}`,
    });
    if (r.commit) {
      await db().from("acc_work").update(UNPROVEN).eq("id", w.id as string); // new code: prove it again
      await invalidate(w, ["approve_try", "ship"], "new code since the preview was approved");
    }
    // Escalation only goes up: a build that reached a protected area needs the full review (gen2-crew.md §17.2).
    const up = escalation(toWork(w).complexity, r.files ?? []);
    if (up) {
      await db()
        .from("acc_work")
        .update({ complexity: up.complexity, complexity_set_by: "platform", complexity_reason: up.reason, auto_ship: false, plan_approved_at: null, plan_approved_by: null })
        .eq("id", w.id as string);
      await say(w, { kind: "system", label: "Crew", body: `Raised to High complexity. ${up.reason} The crew has stopped; the design and plan come to you for approval before it goes on.` });
      await decide(w, { kind: "tier", actor: { kind: "policy", label: "Escalation policy" }, target: "high", summary: `#${w.number} raised to High complexity. ${up.reason}`, detail: { files: r.files ?? [] } });
      await invalidate(w, ["approve_plan", "auto_ship"], "escalated to High complexity");
    }
    const t = checks.tests;
    const tests = t ? `${t.passed}/${t.total} tests passing${checks.testsBefore != null ? ` (was ${checks.testsBefore})` : ""}` : "tests didn't run";
    await say(w, {
      kind: "model", label, model,
      body: verdict.ok
        ? `${r.summary}\n\nProtocol checks passed: typecheck clean, ${tests}.`
        : `${r.summary}\n\nThis step is blocked by the Protocol:\n${verdict.reasons.map((x) => `- ${x}`).join("\n")}\nAsk me to fix it, or run the step again.`,
    });
  } else if (w && r.kind === "prove") {
    const [site] = await rows(db().from("acc_sites").select("baseline_tests").eq("id", job.site_id as string));
    const f: ProveFacts = { ...r.facts, baseline: (site?.baseline_tests as number) ?? null };
    const verdict = proveVerdict(f);
    const proof: ProveEvidence = { ...f, ...verdict, branch: r.branch, commit: r.commit, previewUrl: r.previewUrl, previewStatus: r.previewStatus, at: now() };
    await db()
      .from("acc_work")
      .update({ proof, preview_url: verdict.ok ? r.previewUrl : null, proven_at: verdict.ok ? now() : null, try_approved_at: null, try_approved_by: null })
      .eq("id", w.id as string);
    await evidence(w, {
      kind: "prove", ok: verdict.ok, commit: r.commit, tests: f.tests, jobId, actor: { kind: "crew", label: "Builder" },
      detail: { reasons: verdict.reasons, build: f.build, typecheck: f.typecheck, previewState: f.previewState, previewUrl: r.previewUrl },
      summary: verdict.ok ? `Proven: every check passed and the preview is up (${(r.commit ?? "").slice(0, 8)}).` : `Prove didn't pass: ${verdict.reasons.join(" ")}`,
    });
    // The code census is a measurement of the candidate, recorded on the same commit (gen2-crew.md §19.5).
    const counted = r.census && readCensus(r.census as unknown as Row);
    if (counted) {
      await evidence(w, {
        kind: "census", ok: true, counts: false, commit: r.commit, jobId, actor: { kind: "crew", label: "Builder" }, detail: counted as unknown as Row,
        summary: `Code census on ${(r.commit ?? "").slice(0, 8)}: ${counted.functions} functions, ${counted.components} components, ${counted.routes} routes.`,
      });
    }
    const t = f.tests ? `${f.tests.passed}/${f.tests.total} tests passing` : "no tests ran";
    const guarded = r.previewStatus === 401 || r.previewStatus === 403 ? " It's behind Vercel's protection, so sign in to Vercel to open it." : "";
    await say(w, {
      kind: "model", label, model,
      body: verdict.ok
        ? `Proven: typecheck clean, ${t}${f.build ? ", production build ok" : ""}. The branch is pushed and the preview is up:\n\n${r.previewUrl}\n\nTry it.${guarded} Approve it for release when it's right, or tell me what to change.`
        : `Prove didn't pass:\n${verdict.reasons.map((x) => `- ${x}`).join("\n")}\nAsk me to fix it, then prove again.`,
    });
  } else if (w && r.kind === "release") {
    const verdict = releaseVerdict(r);
    const release: ReleaseEvidence = {
      ok: verdict.ok, reasons: [...(r.reasons ?? []), ...verdict.reasons], stageCommit: r.stageCommit, mainCommit: r.mainCommit,
      productionState: r.productionState, liveUrl: r.liveUrl, liveStatus: r.liveStatus, at: now(),
    };
    // main moved: the change is released, even if the live check needs a look.
    await db().from("acc_work").update({ release, released_at: r.mainCommit ? now() : null }).eq("id", w.id as string);
    await evidence(w, {
      kind: "release", ok: verdict.ok, commit: r.mainCommit, jobId, actor: { kind: "crew", label: "Release" },
      detail: { reasons: release.reasons, productionState: r.productionState, liveUrl: r.liveUrl, liveStatus: r.liveStatus },
      summary: verdict.ok ? `Live: ${r.liveUrl} answers ${r.liveStatus}.` : r.mainCommit ? "Released to main; the live check needs a look." : "The release didn't reach main.",
    });
    await say(w, {
      kind: "model", label, model,
      body: verdict.ok
        ? `Live. main is at ${r.mainCommit!.slice(0, 8)}, production deployed, and ${r.liveUrl} answers ${r.liveStatus}. Anything to learn from this one? Say it here, then close the item.`
        : r.mainCommit
          ? `Released to main (${r.mainCommit.slice(0, 8)}), but the live check needs a look:\n${release.reasons.map((x) => `- ${x}`).join("\n")}\nIf the site is broken, roll back in Vercel (Instant Rollback) and tell me what you see.`
          : `The release didn't reach main:\n${release.reasons.map((x) => `- ${x}`).join("\n")}\nNothing on the live site changed.`,
    });
  } else if (r.kind === "checkout") {
    for (const it of r.items) {
      await db().from("acc_setup_items").update({ status: it.status, note: it.note ?? null, evidence: it.evidence ?? {}, updated_at: now() }).eq("site_id", job.site_id as string).eq("code", it.code);
    }
    if (r.baselineTests != null) await db().from("acc_sites").update({ baseline_tests: r.baselineTests }).eq("id", job.site_id as string);
    if (r.manifest?.length) {
      // The site's key list, from .env.example: what Configuration shows and the vault fills.
      const service = (key: string) => {
        const word = key.split("_")[0]!; // MONGODB_URI → Mongodb
        return word[0] + word.slice(1).toLowerCase();
      };
      await db()
        .from("acc_env_specs")
        .upsert(
          r.manifest.map((m) => ({ org_id: job.org_id, site_id: job.site_id, key: m.key, service: service(m.key), purpose: m.purpose || m.key, how_to_get: m.howToGet || null, secret: /KEY|SECRET|TOKEN|PASS|URI|PASSWORD/.test(m.key) })),
          { onConflict: "site_id,key" },
        );
    }
  }

  await db().from("acc_jobs").update({ status: "done", result: r, finished_at: now() }).eq("id", jobId);
  if (w) {
    await restage(w.id as string);
    // The crew goes on by itself until the next decision the tier keeps for a person (gen2-crew.md §17).
    await drive({ id: job.site_id as string, orgId: job.org_id as string }, w.id as string, job.created_by as string);
  }
}
