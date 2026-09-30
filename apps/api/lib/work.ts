import {
  agreementText,
  isRisky,
  protocolVerdict,
  resolveModels,
  SETUP_TEMPLATE,
  setupDone,
  stageFor,
  validateModels,
  workActions,
  modelLabel,
  type Identity,
  type Job,
  type JobContext,
  type JobEvent,
  type JobKind,
  type ModelRole,
  type RiskClass,
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
import { db, rows, type Row } from "./supabase";

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
  title: r.title as string,
  stage: r.stage as WorkItem["stage"],
  cadence: r.cadence as WorkItem["cadence"],
  risk: (r.risk as RiskClass[]) ?? [],
  branch: (r.branch as string) ?? null,
  planApproved: !!r.plan_approved_at,
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
    jobRunning: p.jobs.some((j) => j.status === "queued" || j.status === "running"),
    latestDesign: latest ? { version: latest.version, approved: !!latest.approvedAt } : null,
    planApproved: w.planApproved,
    steps: p.steps,
  };
};

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
  return { work, ...p, events: events as unknown as JobEvent[], actions: workActions(facts(work, p)), models, runnerOnline: online };
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
  const { latestDesign, planApproved, steps } = facts(work, p);
  const stage = stageFor({ risk: work.risk, latestDesign, planApproved, steps });
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

export async function createWork(site: Site, identity: Identity, name: string, input: { title: string; message: string; risk: RiskClass[] }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [top] = await rows(db().from("acc_work").select("number").eq("site_id", site.id).order("number", { ascending: false }).limit(1));
    const number = ((top?.number as number) ?? 0) + 1;
    const { data, error } = await db()
      .from("acc_work")
      .insert({
        org_id: site.orgId, site_id: site.id, number, title: input.title.trim(), risk: input.risk,
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

export async function postMessage(site: Site, identity: Identity, name: string, number: number, body: string) {
  const w = await workRow(site.id, number);
  await say(w, { kind: "person", label: personLabel(identity, name), userId: identity.userId, body: body.trim() });
  await enqueue(site, w, "discuss", "consult", identity.userId);
}

export async function draftDesign(site: Site, identity: Identity, number: number, note?: string) {
  const w = await workRow(site.id, number);
  await enqueue(site, w, "design", "design", identity.userId, note ? { note } : {});
}

/** The Navigator edits design.md: a new version, authored by them (unapproved). */
export async function saveDesign(site: Site, identity: Identity, name: string, number: number, body: string) {
  const w = await workRow(site.id, number);
  const [top] = await rows(db().from("acc_work_docs").select("version").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
  const version = ((top?.version as number) ?? 0) + 1;
  const { error } = await db().from("acc_work_docs").insert({ org_id: w.org_id, work_id: w.id, version, body, author_label: personLabel(identity, name) });
  if (error) throw new Error(error.message);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} edited the design (v${version}).` });
  // A changed design invalidates an approved plan.
  await db().from("acc_work").update({ plan_approved_at: null, plan_approved_by: null }).eq("id", w.id as string);
  await restage(w.id as string);
}

export async function approveDesign(site: Site, identity: Identity, name: string, number: number, version: number) {
  const w = await workRow(site.id, number);
  const [top] = await rows(db().from("acc_work_docs").select("id, version").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
  if (!top || top.version !== version) throw new CodeError("There's a newer version of the design. Review that one first.");
  await db().from("acc_work_docs").update({ approved_by: identity.userId, approved_at: now() }).eq("id", top.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} approved design v${version}.` });
  await restage(w.id as string);
}

export async function draftPlan(site: Site, identity: Identity, number: number, note?: string) {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  if (!p.designs.at(-1)?.approvedAt) throw new CodeError("Approve the design first; the plan is built from it.");
  await enqueue(site, w, "plan", "plan", identity.userId, note ? { note } : {});
}

export async function approvePlan(site: Site, identity: Identity, name: string, number: number) {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  if (!workActions(facts(toWork(w), p)).approvePlan) throw new CodeError("There's no plan ready to approve.");
  await db().from("acc_work").update({ plan_approved_at: now(), plan_approved_by: identity.userId }).eq("id", w.id as string);
  await say(w, { kind: "system", label: "Control Room", body: `${personLabel(identity, name)} approved the plan (${p.steps.length} steps).` });
  await restage(w.id as string);
}

export async function runNextStep(site: Site, identity: Identity, number: number) {
  const w = await workRow(site.id, number);
  const p = await parts(w.id as string);
  const a = workActions(facts(toWork(w), p));
  if (!a.runNextStep || a.nextStep == null) throw new CodeError("There's no approved step to run.");
  const step = p.steps[a.nextStep]!;
  await enqueue(site, w, "build_step", "build", identity.userId, { stepId: step.id });
}

export async function setCadence(site: Site, number: number, cadence: WorkItem["cadence"]) {
  const w = await workRow(site.id, number);
  await db().from("acc_work").update({ cadence, updated_at: now() }).eq("id", w.id as string);
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
    rows(db().from("acc_sites").select("repo_path, base_branch, stage_url, baseline_tests").eq("id", site.id)),
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
    settings: { repoPath: (s?.repo_path as string) ?? null, baseBranch: (s?.base_branch as string) ?? "stage", stageUrl: (s?.stage_url as string) ?? null, baselineTests: (s?.baseline_tests as number) ?? null },
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

export async function saveSiteSettings(site: Site, input: { repoPath?: string | null; baseBranch?: string; stageUrl?: string | null }) {
  const { error } = await db()
    .from("acc_sites")
    .update({
      ...(input.repoPath !== undefined && { repo_path: input.repoPath?.trim() || null }),
      ...(input.baseBranch && { base_branch: input.baseBranch.trim() }),
      ...(input.stageUrl !== undefined && { stage_url: input.stageUrl?.trim() || null }),
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
  return {
    job: { ...toJob(job), role: job.role as ModelRole, input: (job.input as Record<string, unknown>) ?? {} },
    site: {
      id: s!.id as string, slug: s!.slug as string, name: s!.name as string, url: s!.url as string, repoPath: (s!.repo_path as string) ?? null,
      baseBranch: (s!.base_branch as string) ?? "stage", stack: (s!.stack as string) ?? null, baselineTests: (s!.baseline_tests as number) ?? null,
    },
    work,
  };
}

export async function addEvents(jobId: string, events: { kind: JobEvent["kind"]; text: string; data?: unknown }[]) {
  if (!events.length) return;
  const { error } = await db().from("acc_job_events").insert(events.map((e) => ({ job_id: jobId, kind: e.kind, text: e.text.slice(0, 4000), data: e.data ?? null })));
  if (error) throw new Error(error.message);
}

export type JobResult =
  | { kind: "discuss"; reply: string }
  | { kind: "design"; body: string }
  | { kind: "plan"; steps: { title: string; detail: string }[]; summary?: string }
  | { kind: "build_step"; stepId: string; summary: string; checks: Omit<StepChecks, "baseline">; commit?: string; files?: string[] }
  | { kind: "checkout"; items: { code: string; status: "done" | "failed" | "waiting"; note?: string; evidence?: Record<string, unknown> }[]; baselineTests?: number };

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
      if (job.kind === "build_step") await db().from("acc_work_steps").update({ status: "blocked", updated_at: now() }).eq("id", (job.input as Row).stepId as string);
      await say(w, { kind: "system", label: "Runner", body: `The ${String(job.kind).replace("_", " ")} run failed: ${outcome.error ?? "unknown error"}` });
    }
    return;
  }

  const r = outcome.result;
  let next: "build_step" | null = null;
  if (w && r.kind === "discuss") {
    await say(w, { kind: "model", label, model, body: r.reply });
  } else if (w && r.kind === "design") {
    const [top] = await rows(db().from("acc_work_docs").select("version").eq("work_id", w.id as string).order("version", { ascending: false }).limit(1));
    const version = ((top?.version as number) ?? 0) + 1;
    await db().from("acc_work_docs").insert({ org_id: w.org_id, work_id: w.id, version, body: r.body, author_label: label, model });
    await db().from("acc_work").update({ plan_approved_at: null, plan_approved_by: null }).eq("id", w.id as string);
    await say(w, { kind: "model", label, model, body: `Design v${version} is ready for your review. Edit it, ask for changes, or approve it.` });
  } else if (w && r.kind === "plan") {
    await db().from("acc_work_steps").delete().eq("work_id", w.id as string).neq("status", "done");
    const done = (await rows(db().from("acc_work_steps").select("id").eq("work_id", w.id as string))).length;
    await db().from("acc_work_steps").insert(r.steps.map((s, i) => ({ org_id: w.org_id, work_id: w.id, position: done + i + 1, title: s.title, detail: s.detail })));
    await db().from("acc_work").update({ plan_approved_at: null, plan_approved_by: null }).eq("id", w.id as string);
    await say(w, { kind: "model", label, model, body: `${r.summary ? `${r.summary}\n\n` : ""}The plan has ${r.steps.length} steps. Review it, reorder or trim it by asking, then approve.` });
  } else if (w && r.kind === "build_step") {
    const [site] = await rows(db().from("acc_sites").select("baseline_tests").eq("id", job.site_id as string));
    const checks: StepChecks = { ...r.checks, baseline: (site?.baseline_tests as number) ?? null };
    const verdict = protocolVerdict(checks);
    await db()
      .from("acc_work_steps")
      .update({ status: verdict.ok ? "done" : "blocked", evidence: { summary: r.summary, reasons: verdict.reasons, checks, commit: r.commit, files: r.files }, updated_at: now() })
      .eq("id", r.stepId);
    const t = checks.tests;
    const tests = t ? `${t.passed}/${t.total} tests passing${checks.testsBefore != null ? ` (was ${checks.testsBefore})` : ""}` : "tests didn't run";
    await say(w, {
      kind: "model", label, model,
      body: verdict.ok
        ? `${r.summary}\n\nProtocol checks passed: typecheck clean, ${tests}.`
        : `${r.summary}\n\nThis step is blocked by the Protocol:\n${verdict.reasons.map((x) => `- ${x}`).join("\n")}\nAsk me to fix it, or run the step again.`,
    });
    if (verdict.ok && (w.cadence === "run" || (w.cadence === "at_risk" && !isRisky((w.risk as RiskClass[]) ?? [])))) next = "build_step";
  } else if (r.kind === "checkout") {
    for (const it of r.items) {
      await db().from("acc_setup_items").update({ status: it.status, note: it.note ?? null, evidence: it.evidence ?? {}, updated_at: now() }).eq("site_id", job.site_id as string).eq("code", it.code);
    }
    if (r.baselineTests != null) await db().from("acc_sites").update({ baseline_tests: r.baselineTests }).eq("id", job.site_id as string);
  }

  await db().from("acc_jobs").update({ status: "done", result: r, finished_at: now() }).eq("id", jobId);
  if (w) {
    await restage(w.id as string);
    if (next) {
      const p = await parts(w.id as string);
      const a = workActions(facts(toWork({ ...w, plan_approved_at: w.plan_approved_at }), p));
      if (a.runNextStep && a.nextStep != null) {
        await enqueue({ id: job.site_id as string, orgId: job.org_id as string }, w, "build_step", "build", job.created_by as string, { stepId: p.steps[a.nextStep]!.id });
      }
    }
  }
}
