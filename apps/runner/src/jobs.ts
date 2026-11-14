import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  detectTechnologies,
  technologiesLine,
  census,
  cleanDocument,
  cobolDirectGuidance,
  cobolDirectSlice,
  cobolSliceGuidance,
  copyMembers,
  estateOf,
  ingestInstruction,
  isCensusSource,
  isDomain,
  mergeReports,
  numberedFile,
  packFor,
  readAssessment,
  readIngest,
  readReconcile,
  reconcileInstruction,
  roleOf,
  type Census,
  type IngestReport,
  type JobContext,
  type Pack,
} from "@accelerator/domain";

import { modelProxyUrl, secrets, toolbeltUrl, type Log } from "./api";
import { probe, waitForDeployment } from "./deploys";
import { agent, chat, read, type Meter, type Turn } from "./models";
import { buildAppend, buildPrompt, consultSystem, designSystem, planSystem, planText, transcript } from "./prompts";
import { baseRef, changedFiles, checks, codeHome, codeState, commitAll, ensureClone, ensureWorktree, git, gitRemote, headSha, isTestFile, lastProof, saveProof } from "./repo";
import { parseManifest, parseTests, scripts, sh, siteEnv, tail } from "./sh";

/**
 * The site's test keys: the vault first. envmachine is a logged fallback during
 * the switchover (gen2-crew.md §4.2), switched off with RUNNER_ENVMACHINE=off.
 */
const devEnv = async (ctx: JobContext, log?: Log) => {
  const vault = await secrets(ctx.job.id).then((r) => r.env).catch(() => ({}) as Record<string, string>);
  const fallback = process.env.RUNNER_ENVMACHINE === "off" ? {} : siteEnv(ctx.site.slug);
  const borrowed = Object.keys(fallback).filter((k) => !(k in vault));
  if (borrowed.length && log) log.status(`envmachine fallback supplied ${borrowed.length} key(s) the vault doesn't have (${borrowed.join(", ")}). Move them to the vault, then set RUNNER_ENVMACHINE=off.`);
  return { ...fallback, ...vault };
};

/** The agent session each job ran in, reported with its result so the Work item's next job continues it (§17 F4). */
const sessions = new WeakMap<JobContext, string>();
export const agentSession = (ctx: JobContext) => sessions.get(ctx);
const toolbelt = (ctx: JobContext) => (ctx.toolbeltToken ? { url: toolbeltUrl(), token: ctx.toolbeltToken } : null);

/** G2.2b: with RUNNER_MODEL_PROXY=on the agent holds only its job token; the API holds the model key. */
const modelProxy = (ctx: JobContext) => (process.env.RUNNER_MODEL_PROXY === "on" && ctx.toolbeltToken ? { url: modelProxyUrl(), token: ctx.toolbeltToken } : null);

/** What each job's model runs cost, reported with its result (the mandate's budget reads it). */
const costs = new WeakMap<JobContext, number>();
const meters = new WeakMap<JobContext, Map<string, Meter>>();
export const jobCost = (ctx: JobContext) => costs.get(ctx);
/** The job's spend per model (B20): Sonnet reading slices and Opus reconciling show apart on the Spend page. */
export const jobMeter = (ctx: JobContext): Meter[] | undefined => {
  const m = meters.get(ctx);
  return m?.size ? [...m.values()].map((x) => ({ ...x, costUsd: Math.round(x.costUsd * 1e6) / 1e6 })) : undefined;
};
const spent = (ctx: JobContext, r: { costUsd: number; meter?: Meter[] }) => {
  costs.set(ctx, (costs.get(ctx) ?? 0) + (Number.isFinite(r.costUsd) ? r.costUsd : 0));
  const m = meters.get(ctx) ?? new Map<string, Meter>();
  for (const x of r.meter ?? []) {
    const cur = m.get(x.model) ?? { model: x.model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
    m.set(x.model, { model: x.model, tokensIn: cur.tokensIn + x.tokensIn, tokensOut: cur.tokensOut + x.tokensOut, costUsd: cur.costUsd + (Number.isFinite(x.costUsd) ? x.costUsd : 0) });
  }
  meters.set(ctx, m);
};

/**
 * One function per job kind. Each returns the result the API applies to
 * the rail (lib/work.ts finish). Throwing fails the job with the message.
 */
type Work = NonNullable<JobContext["work"]>;

const needWork = (ctx: JobContext): Work => {
  if (!ctx.work) throw new Error("This job has no work item.");
  return ctx.work;
};

/** Where thinking jobs read code: the work item's own worktree, when the site has a repository. */
async function workDir(ctx: JobContext, w: Work, log: Log): Promise<string | null> {
  if (!ctx.site.repoPath) return null;
  if (w.kind === "install") return ctx.site.repoPath; // read-only look at the site as it is
  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, `work-${w.number}`, w.branch ?? `work/${w.number}`, ctx.site.baseBranch, { log });
  log.status(`Working copy: ${w.branch}`);
  return dir;
}

/** A thinking job: Claude reads the code (Agent SDK, read-only) when it can; any other model works from the conversation. */
async function think(ctx: JobContext, log: Log, system: string, instruction: string): Promise<string> {
  const w = needWork(ctx);
  const { provider, model } = ctx.job;
  const dir = provider === "anthropic" ? await workDir(ctx, w, log) : null;
  log.status(`${model} is ${ctx.job.kind === "discuss" ? "replying" : `writing the ${ctx.job.kind}`}…`);
  if (dir) {
    const r = await agent({
      cwd: dir, model, append: [system, codeState(dir)].filter(Boolean).join("\n\n"), mode: "read", log, prompt: `THE CONVERSATION SO FAR\n\n${transcript(w)}\n\n${instruction}`,
      resume: w.agentSessionId, toolbelt: toolbelt(ctx), modelProxy: modelProxy(ctx),
    });
    if (r.sessionId) sessions.set(ctx, r.sessionId);
    spent(ctx, r);
    if (!r.ok || !r.text.trim()) throw new Error(`The model stopped early (${r.reason ?? "no answer"}).`);
    return r.text.trim();
  }
  const turns: Turn[] = w.messages.map((m) =>
    m.authorKind === "person" ? { role: "user", content: m.body } : m.authorKind === "model" ? { role: "assistant", content: m.body } : { role: "user", content: `[Control Room] ${m.body}` },
  );
  if (!turns.length || turns[0]!.role !== "user") turns.unshift({ role: "user", content: `Work item: ${w.title}` });
  turns.push({ role: "user", content: instruction });
  return chat(provider as Parameters<typeof chat>[0], model, system, turns);
}

/** The lead's reply, with its complexity assessment split off (gen2-crew.md §17.2). */
export async function discuss(ctx: JobContext, log: Log) {
  const raw = await think(ctx, log, consultSystem(ctx), "Reply to the Navigator's latest message, then add the assessment lines.");
  const { reply, assessment } = readAssessment(raw);
  if (assessment) log.status(`Assessed: ${assessment.complexity} complexity, ${assessment.ready ? "ready to start" : "not ready yet"}.`);
  return { kind: "discuss", reply: reply || raw, ...(assessment && { assessment }) };
}

export async function design(ctx: JobContext, log: Log) {
  const w = needWork(ctx);
  const note = typeof ctx.job.input.note === "string" ? `\nThe Navigator adds: ${ctx.job.input.note}` : "";
  const current = w.design ? `\n\nTHE CURRENT DESIGN (v${w.design.version}); revise it to reflect the conversation since:\n\n${w.design.body}` : "";
  const raw = await think(ctx, log, designSystem(ctx), `Write the design document now.${note}${current}`);
  return { kind: "design", body: cleanDocument(raw) || raw.trim() };
}

export async function plan(ctx: JobContext, log: Log) {
  const w = needWork(ctx);
  if (!w.design?.approvedAt) throw new Error("The design isn't approved.");
  const note = typeof ctx.job.input.note === "string" ? `\nThe Navigator adds: ${ctx.job.input.note}` : "";
  const done = w.steps.filter((s) => s.status === "done");
  const prior = done.length ? `\n\nAlready done (keep; plan only the remaining work):\n${planText(done)}` : "";
  const raw = await think(ctx, log, planSystem(ctx), `THE APPROVED DESIGN\n\n${w.design.body}${prior}${note}\n\nReply with the JSON plan only.`);
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { summary?: string; steps?: { title?: string; detail?: string }[] };
  const steps = (parsed.steps ?? []).filter((s) => s.title?.trim()).map((s) => ({ title: s.title!.trim().slice(0, 200), detail: (s.detail ?? "").trim().slice(0, 4000) }));
  if (!steps.length) throw new Error("The plan came back empty.");
  return { kind: "plan", steps, summary: parsed.summary };
}

export async function buildStep(ctx: JobContext, log: Log) {
  const w = needWork(ctx);
  const step = w.steps.find((s) => s.id === ctx.job.input.stepId);
  if (!step) throw new Error("That step is no longer in the plan.");
  if (!ctx.site.repoPath) throw new Error("This site has no code connected yet: set its GitHub repository (or a local copy) in Setup.");
  if (ctx.job.provider !== "anthropic") throw new Error("Building needs a model with an agent harness (Claude at launch).");

  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, `work-${w.number}`, w.branch ?? `work/${w.number}`, ctx.site.baseBranch, { log });
  const env = await devEnv(ctx, log);
  log.status(`Step ${step.position}: ${step.title}`);

  // Before: the suite as it stands, so the step can't shrink it. When the last step's proof ran on this exact
  // commit, its count stands (B33): the suite isn't run twice on the same code.
  // Changes an earlier attempt of this step left uncommitted (it stopped early): the builder is told, not surprised.
  const leftovers = (await git("status --porcelain", dir)).out.split(/\r?\n/).filter((l) => l.trim()).length;
  const proven = await lastProof(dir);
  const testsBefore = proven ? proven.tests : await (async () => {
    const before = await checks(dir, env);
    return before.test ? parseTests(before.test.out)?.total ?? null : null;
  })();
  log.check(`Before: ${testsBefore ?? "no"} tests${proven ? " (from the last step's proof on this commit)" : ""}`);
  const from = await headSha(dir);

  // A repair run: the crew re-runs a step the Protocol blocked, told exactly what failed (gen2-crew.md §17.4).
  const repair = Array.isArray(ctx.job.input.repairReasons) ? (ctx.job.input.repairReasons as unknown[]).map(String) : [];
  if (repair.length) log.status(`Repairing: ${repair.join(" ")}`);
  // Each step starts a fresh session with a written handoff (B33). Resuming the Work item's session made every
  // turn re-send all earlier steps: step 3 of the blog upgrade re-sent about 450k tokens a turn. The build
  // session isn't kept as the Work item's session either, so the Team Lead's replies stay small.
  const r = await agent({
    cwd: dir, model: ctx.job.model, append: [buildAppend(ctx), codeState(dir)].filter(Boolean).join("\n\n"), mode: "build", log, prompt: buildPrompt(w, step, repair, ctx.site.baseBranch, leftovers),
    toolbelt: toolbelt(ctx), siteEnv: env, modelProxy: modelProxy(ctx),
  });
  spent(ctx, r);
  if (!r.ok) {
    // Keep where it got to: the repair run starts from this (B33). The changes stay in the working copy, uncommitted.
    const notes = (r.notes ?? []).slice(-3).join(" … ").replace(/\s+/g, " ").slice(0, 1800);
    const left = (await git("status --porcelain", dir)).out.split(/\r?\n/).filter((l) => l.trim()).length;
    throw new Error(`The builder stopped early (${r.reason}) after spending $${r.costUsd.toFixed(2)}.${left ? ` ${left} changed files are left uncommitted in the working copy.` : ""}${notes ? ` Its last notes: ${notes}` : ""}`);
  }

  // After: the runner's own checks decide the verdict, not the model's report.
  log.status("Running the Protocol checks…");
  const after = await checks(dir, env);
  const typecheck = !after.typecheck || after.typecheck.code === 0;
  const tests = after.test ? parseTests(after.test.out) : null;
  log.check(`Typecheck: ${typecheck ? "clean" : "failed"}`, after.typecheck ? tail(after.typecheck.out) : undefined);
  log.check(tests ? `Tests: ${tests.passed}/${tests.total} passing` : "Tests: didn't run", after.test ? tail(after.test.out) : undefined);

  const commit = await commitAll(dir, `work #${w.number} step ${step.position}: ${step.title}`);
  if (tests && typecheck && !tests.failed) await saveProof(dir, tests.total);
  const files = commit ? await changedFiles(dir, from) : [];
  if (commit) log.tool(`Committed ${commit.slice(0, 8)} on ${w.branch} (${files.length} files)`);

  const reason = r.text.match(/NO_TESTS_REASON:\s*(.+)/)?.[1]?.trim();
  const summary = r.text.replace(/NO_TESTS_REASON:.*$/m, "").trim() || `Step ${step.position} built.`;
  return {
    kind: "build_step",
    stepId: step.id,
    summary,
    checks: { typecheck, tests, testsBefore, touchedTests: files.some(isTestFile), noTestsReason: reason },
    commit: commit ?? undefined,
    files,
  };
}

// ── Prove · Release (flywheel.md F14) ─────────────────────────────────────────
/** Git with this machine's credentials, never prompting (a prompt would hang the runner). */
const gitAs = (args: string, cwd: string) => sh(`git -c user.name="Accelerator Engine" -c user.email="engine@strategicmachines.ai" ${args}`, cwd, {}, 120_000);
const githubToken = (env: Record<string, string>) => process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || undefined;

/**
 * Point the job at its code before it runs: each repository's local copy when
 * this machine has one, else the runner's own clone from GitHub (cloned on
 * the first job, brought up to date on each one after). This is what lets a
 * hosted runner, with no local copies, work every site. A clone that fails is
 * logged; the job then reports the missing code in its own words.
 */
export async function locateCode(ctx: JobContext, log: Log) {
  let token: string | undefined;
  const tokenFor = async () => (token ??= githubToken(await devEnv(ctx)));
  const find = async (label: string, path: string | null, repo: string | null) => {
    const home = codeHome(path, repo);
    if (!home) return path;
    if (!home.clone) return home.dir;
    try {
      const how = await ensureClone(home.clone, home.dir, await tokenFor());
      log.status(`${how === "cloned" ? "Cloned" : "Updated"} ${home.clone} from GitHub (${label}: no local copy on this runner)`);
      return home.dir;
    } catch (err) {
      log.check(`${label}: ${(err as Error).message}`);
      return path;
    }
  };
  // A reply with no code (the API leaves the path empty on purpose) stays that way.
  if (ctx.site.repoPath || ctx.job.kind !== "discuss") ctx.site.repoPath = await find(ctx.site.name, ctx.site.repoPath, ctx.site.repo);
  if (ctx.site.sources?.length) {
    const located = [];
    for (const s of ctx.site.sources) located.push({ ...s, path: await find(s.label, s.path, s.repo) });
    ctx.site.sources = located;
  }
}

/** Typecheck, tests and the production build, as the site defines them. */
async function fullChecks(dir: string, env: Record<string, string>, log: Log) {
  const c = await checks(dir, env);
  const build = scripts(dir).build ? await sh("pnpm build", dir, env) : null;
  const typecheck = !c.typecheck || c.typecheck.code === 0;
  const tests = c.test ? parseTests(c.test.out) : null;
  log.check(`Typecheck ${typecheck ? "clean" : "failed"} · tests ${tests ? `${tests.passed}/${tests.total}` : "didn't run"} · build ${build ? (build.code === 0 ? "ok" : "failed") : "n/a"}`);
  if (!typecheck && c.typecheck) log.check("Typecheck output", tail(c.typecheck.out));
  if (tests?.failed && c.test) log.check("Test output", tail(c.test.out));
  if (build && build.code !== 0) log.check("Build output", tail(build.out));
  const ok = typecheck && !!tests && tests.failed === 0 && (!build || build.code === 0);
  return { ok, typecheck, tests, build: build ? build.code === 0 : null };
}

/** Prove: the full checks, then push work/<n> and wait for its Vercel preview. The API judges the result. */
export async function prove(ctx: JobContext, log: Log) {
  const w = needWork(ctx);
  if (!ctx.site.repoPath) throw new Error("This site has no code connected yet: set its GitHub repository (or a local copy) in Setup.");
  if (!ctx.site.repo) throw new Error("This site has no GitHub repository set (Setup → repository).");
  const branch = w.branch ?? `work/${w.number}`;
  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, `work-${w.number}`, branch, ctx.site.baseBranch, { log });
  const env = await devEnv(ctx);

  if (ctx.record) await writeRecord(dir, w.number, ctx.record, log);
  log.status("Prove: typecheck, tests and the production build");
  const c = await fullChecks(dir, env, log);
  const commit = await headSha(dir);
  const counted = await codeCensus(dir, log);
  const result = { kind: "prove" as const, branch, commit, previewUrl: null as string | null, previewStatus: null as number | null, ...(counted && { census: counted }) };
  const facts = { typecheck: c.typecheck, build: c.build, tests: c.tests, pushed: false, previewState: "skipped" };
  if (!c.ok) return { ...result, facts }; // don't publish a preview of code that fails its checks

  log.status(`Pushing ${branch}…`);
  const push = await gitRemote(`push -u origin ${branch}`, dir);
  facts.pushed = push.code === 0;
  log.tool(facts.pushed ? `Pushed ${commit.slice(0, 8)} to ${branch}` : `Push failed: ${tail(push.out, 400)}`);
  if (!facts.pushed) return { ...result, facts: { ...facts, previewState: "missing" } };

  const d = await waitForDeployment(ctx.site.repo, commit, "preview", log, githubToken(env));
  facts.previewState = d.state;
  const previewStatus = d.url ? await probe(d.url) : null;
  log.check(d.url ? `Preview ${d.state}: ${d.url} (answers ${previewStatus ?? "nothing"})` : `No preview (${d.state})`);
  return { ...result, facts, previewUrl: d.url, previewStatus };
}

/**
 * The Librarian's /docs sync (traceability T5): the item's record, built by
 * the API from the decisions and evidence, committed under docs/accelerator/
 * on the Work item's branch before Prove, so the proven candidate carries
 * it. Deterministic: an unchanged record makes no commit. Never fails Prove.
 */
async function writeRecord(dir: string, number: number, record: { path: string; body: string }, log: Log) {
  try {
    if (!/^docs\/accelerator\/[\w.-]+\.md$/.test(record.path)) throw new Error(`refused path ${record.path}`);
    const full = join(dir, record.path);
    if (existsSync(full) && readFileSync(full, "utf8") === record.body) return;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, record.body, "utf8");
    const sha = await commitAll(dir, `docs: Accelerator record for work #${number}`);
    if (sha) log.tool(`Librarian: wrote ${record.path} (${sha.slice(0, 8)})`);
  } catch (err) {
    log.check(`The record wasn't written: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The code census on the candidate (gen2-crew.md §19.5): tracked source only,
 * so dependencies and build output never count. A measurement, so a failure
 * here is logged and never fails Prove.
 */
async function codeCensus(dir: string, log: Log): Promise<Census | null> {
  try {
    const listed = await git("ls-files", dir);
    if (listed.code !== 0) throw new Error(tail(listed.out, 200));
    const paths = listed.out.split(/\r?\n/).map((p) => p.trim()).filter((p) => p && isCensusSource(p)).slice(0, 20_000);
    const files = paths.flatMap((path) => {
      const full = join(dir, path);
      if (!existsSync(full) || statSync(full).size > 512_000) return []; // skip giant generated files
      return [{ path, text: readFileSync(full, "utf8") }];
    });
    const c = census(files);
    log.check(`Code census: ${c.functions} functions, ${c.components} components, ${c.routes} routes, ${c.files} files, ${c.lines} lines`);
    return c;
  } catch (err) {
    log.check(`Code census skipped: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Release (Go live, after the Navigator approved the Try): bring stage up to
 * date with main, merge work/<n>, check again, push stage, move main to stage
 * (a fast-forward: stage contains main), then wait for production and check
 * the live site. Stops before main if anything isn't clean.
 */
export async function release(ctx: JobContext, log: Log) {
  const w = needWork(ctx);
  if (!ctx.site.repoPath || !ctx.site.repo) throw new Error("This site needs a repository path and a GitHub repository (Setup).");
  const base = ctx.site.baseBranch;
  const branch = w.branch ?? `work/${w.number}`;
  const out = { kind: "release" as const, stageCommit: null as string | null, mainCommit: null as string | null, productionState: "missing", liveUrl: ctx.site.url, liveStatus: null as number | null, reasons: [] as string[] };
  const stop = (reason: string) => {
    log.check(reason);
    return { ...out, reasons: [reason] };
  };

  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, "release", "accelerator/release", base, { log, sync: false });
  const fetched = await gitRemote("fetch origin --prune", dir);
  if (fetched.code !== 0) return stop(`Couldn't fetch from GitHub: ${tail(fetched.out, 300)}`);
  const hasBase = (await git(`rev-parse --verify --quiet origin/${base}`, dir)).code === 0;
  await git(`reset -q --hard origin/${hasBase ? base : "main"}`, dir);

  log.status(`Bringing ${base} up to date with main…`);
  const m1 = await gitAs("merge --no-edit origin/main", dir);
  if (m1.code !== 0) {
    await git("merge --abort", dir);
    return stop(`${base} and main conflict. Nothing was released; resolve the conflict, then release again.`);
  }
  log.status(`Merging ${branch} into ${base}…`);
  const m2 = await gitAs(`merge --no-ff -m ${JSON.stringify(`Release #${w.number}: ${w.title}`)} origin/${branch}`, dir);
  if (m2.code !== 0) {
    await git("merge --abort", dir);
    return stop(`${branch} conflicts with ${base}. Nothing was released; ask the engine to rebase the work, prove it again, then release.`);
  }

  log.status("Checking the merged result before it goes anywhere…");
  const env = await devEnv(ctx);
  const c = await fullChecks(dir, env, log);
  if (!c.ok) return stop("The merged result fails its checks. Nothing was released.");

  const sha = await headSha(dir);
  const pushStage = await gitRemote(`push origin HEAD:${base}`, dir);
  if (pushStage.code !== 0) return stop(`Couldn't push ${base}: ${tail(pushStage.out, 300)}`);
  out.stageCommit = sha;
  log.tool(`${base} is at ${sha.slice(0, 8)}`);

  const pushMain = await gitRemote("push origin HEAD:main", dir);
  if (pushMain.code !== 0) return stop(`${base} is updated, but main couldn't be moved: ${tail(pushMain.out, 300)}`);
  out.mainCommit = sha;
  log.tool(`main is at ${sha.slice(0, 8)}: production deploys from here`);

  const d = await waitForDeployment(ctx.site.repo, sha, "production", log, githubToken(env));
  out.productionState = d.state;
  out.liveStatus = await probe(ctx.site.url);
  log.check(`Production ${d.state}; ${ctx.site.url} answers ${out.liveStatus ?? "nothing"}`);
  return out;
}

/** Checkout (flywheel.md §3): prove what can be proven; say plainly what's still waiting. */
export async function checkout(ctx: JobContext, log: Log) {
  type Item = { code: string; status: "done" | "failed" | "waiting"; note?: string; evidence?: Record<string, unknown> };
  const items: Item[] = [];
  const repo = ctx.site.repoPath;
  let baselineTests: number | undefined;
  let manifest: ReturnType<typeof parseManifest> = [];

  if (!repo || !existsSync(join(repo, ".git"))) {
    items.push({ code: "C1", status: "failed", note: repo ? `${repo} isn't a git repository.` : "No code connected yet: set the GitHub repository (or a local copy) in Setup." });
  } else if ((await git("rev-parse --verify HEAD", repo)).code !== 0) {
    items.push({ code: "C1", status: "failed", note: "The repository has no commits yet. Commit the code, then run checkout again." });
  } else {
    // The base branch the engine builds from; create it locally from HEAD if it's missing.
    if ((await git(`rev-parse --verify --quiet refs/heads/${ctx.site.baseBranch}`, repo)).code !== 0) {
      const made = await git(`branch ${ctx.site.baseBranch}`, repo);
      log.tool(made.code === 0 ? `Created the ${ctx.site.baseBranch} branch from the current commit` : `Couldn't create ${ctx.site.baseBranch}: ${made.out}`);
    }
    const dir = await ensureWorktree(repo, ctx.site.slug, "checkout", `accelerator/checkout`, ctx.site.baseBranch, { log, sync: false });
    await git(`reset -q --hard ${await baseRef(repo, ctx.site.baseBranch)}`, dir);
    const env = await devEnv(ctx);
    log.status("C1: install, build, typecheck, tests");
    const c = await checks(dir, env);
    const s = scripts(dir);
    const build = s.build ? await sh("pnpm build", dir, env) : null;
    const tests = c.test ? parseTests(c.test.out) : null;
    const ok = (!c.install || c.install.code === 0) && c.typecheck?.code === 0 && (!build || build.code === 0) && !!tests && tests.failed === 0;
    baselineTests = tests?.total;
    log.check(`Typecheck ${c.typecheck?.code === 0 ? "clean" : "failed"} · build ${build ? (build.code === 0 ? "ok" : "failed") : "n/a"} · tests ${tests ? `${tests.passed}/${tests.total}` : "none found"}`);
    items.push({
      code: "C1",
      status: ok ? "done" : "failed",
      note: ok ? `Baseline: ${tests!.total} tests passing on ${ctx.site.baseBranch}.` : "Something didn't pass; see the evidence.",
      evidence: { typecheck: tail(c.typecheck?.out ?? "", 800), build: build ? tail(build.out, 800) : null, tests: c.test ? tail(c.test.out, 800) : null },
    });

    // C4: the manifest.
    const example = join(dir, ".env.example");
    manifest = existsSync(example) ? parseManifest(readFileSync(example, "utf8")) : [];
    const keys = manifest.map((m) => m.key);
    const missing = keys.filter((k) => !env[k]);
    items.push({
      code: "C4",
      status: !keys.length ? "failed" : missing.length ? "waiting" : "done",
      note: !keys.length ? "No .env.example: the engine can't list the keys this site needs." : missing.length ? `Not set for Development: ${missing.join(", ")} (Configuration → keys)` : `All ${keys.length} keys set for Development.`,
      evidence: { keys },
    });

    // C6: the rulebook.
    const rulebook = existsSync(join(dir, "CLAUDE.md"));
    items.push({ code: "C6", status: rulebook ? "done" : "failed", note: rulebook ? "CLAUDE.md found; the engine follows it." : "No CLAUDE.md yet; ask the engine to draft one as a Work item." });

    // C7: baselines recorded where we can.
    items.push({ code: "C7", status: tests ? "done" : "waiting", note: tests ? `Test baseline ${tests.total}. Lighthouse and data baselines come with preview deploys.` : "No test suite to baseline." });

    // C2: push a throwaway branch, see its Vercel preview load, then delete the branch.
    if (ctx.site.repo && ok) {
      log.status("C2: push a branch and wait for its preview");
      // A new (empty) commit: Vercel doesn't deploy a push of a commit it has already deployed.
      await gitAs(`commit -q --allow-empty -m "Accelerator checkout: preview test"`, dir);
      const sha = await headSha(dir);
      const push = await gitRemote("push -f origin HEAD:refs/heads/accelerator/checkout", dir);
      if (push.code !== 0) {
        items.push({ code: "C2", status: "failed", note: `Couldn't push to GitHub from this machine: ${tail(push.out, 300)}` });
      } else {
        const d = await waitForDeployment(ctx.site.repo, sha, "preview", log, githubToken(env), 6 * 60_000);
        const status = d.url ? await probe(d.url) : null;
        await gitRemote("push origin --delete accelerator/checkout", dir);
        const guarded = status === 401 || status === 403 ? " (behind Vercel protection: sign in to Vercel to view previews)" : "";
        items.push({
          code: "C2",
          status: d.state === "success" ? "done" : "failed",
          note: d.state === "success" ? `Preview deployed: ${d.url}${guarded}.` : d.state === "missing" ? "No preview appeared. Link the Vercel project to the repository with previews on." : `The preview ended in "${d.state}".`,
          evidence: { url: d.url, status, environment: d.environment },
        });
      }
    }
  }

  // What needs GitHub + Vercel + a test database is waiting on Install, and says so.
  if (!items.some((i) => i.code === "C2")) items.push({ code: "C2", status: "waiting", note: "Needs a passing C1 and the site's GitHub repository (Setup)." });
  items.push({ code: "C3", status: "waiting", note: "Needs the test database (I5)." });
  items.push({ code: "C5", status: "waiting", note: "Proven once the GitHub App and branch protection are in (I1, I2)." });
  return { kind: "checkout", items, baselineTests, manifest };
}

/**
 * Gen 3 ingest (gen3-cradle.md §5): the Policy Extractor reads the site's
 * code, read-only, and reports the policies it implies, matched to the
 * industry pack. The API lands them on the site's book, unconfirmed. A system
 * can live in several repositories (a web app, an API server, an auth server,
 * a COBOL estate): each is read its own way (a mainframe estate in slices,
 * §11.2; a web app in one pass) and, when there are several, a reconciling
 * pass finds the contradictions between them.
 */
export async function ingest(ctx: JobContext, log: Log) {
  const chosen = (ctx.job.input as { pack?: unknown } | undefined)?.pack;
  const pack = packFor(isDomain(chosen) ? chosen : null);
  if (!pack) throw new Error("This site has no industry pack yet. Start the cradle first.");
  if (ctx.job.provider !== "anthropic") throw new Error("Ingest reads the code with Claude; choose an Anthropic model for the Design role.");
  const sources = [{ label: ctx.site.name, path: ctx.site.repoPath }, ...(ctx.site.sources ?? []).map((s) => ({ label: s.label, path: s.path }))];
  const ready = sources.filter((s) => s.path && existsSync(join(s.path, ".git")));
  for (const s of sources.filter((x) => !ready.includes(x))) log.check(`judge> ${s.label}: no local copy at ${s.path ?? "(no path set)"}, so it is skipped`);
  if (!ready.length) throw new Error("No code connected yet: set the GitHub repository (or a local copy) in Setup.");
  log.status(`lead> cradle ingest ${ctx.site.slug} · pack ${pack.id} ${pack.version} · read-only${ready.length > 1 ? ` · ${ready.length} code sources` : ""}`);

  const reports: IngestReport[] = [];
  for (const s of ready) {
    if (ready.length > 1) log.status(`lead> reading ${s.label} · ${s.path}`);
    try {
      const r = await readSource(ctx, log, s.path!, pack);
      // With several sources, every citation says which one it is in.
      reports.push(ready.length > 1 ? { ...r, candidates: r.candidates.map((c) => ({ ...c, sources: c.sources.map((x) => ({ ...x, path: `${s.label}: ${x.path}` })) })) } : r);
    } catch (err) {
      if (ready.length === 1) throw err;
      log.check(`judge> ${s.label} FAIL: ${err instanceof Error ? err.message : String(err)}. The other sources go on.`);
    }
  }
  if (!reports.length) throw new Error("No code source could be read.");
  const report = reports.length === 1 ? reports[0]! : await reconcile(ctx, log, ready[0]!.path!, pack, mergeReports(reports), `${reports.length} code sources`);
  log.status(`lead> ${report.candidates.length} policies found in code · ${report.conflicts.length} contradictions · ready for the Policy Walk`);
  return { kind: "ingest" as const, report };
}

/** One repository, read the way its technology needs. */
async function readSource(ctx: JobContext, log: Log, repo: string, pack: Pack): Promise<IngestReport> {
  const files = await trackedFiles(repo);
  // Which technology packs this system needs, at what level (gen3-cradle.md §15.4); framework packs inside another language's files (CICS in COBOL) are found by content.
  const tech = detectTechnologies(files, (path) => {
    const full = join(repo, path);
    return existsSync(full) && statSync(full).size <= 2_000_000 ? readFileSync(full, "latin1") : null;
  });
  log.status(`surveyor> technologies: ${technologiesLine(tech.detected, tech.unclaimed)}`);
  const estate = estateOf(files);
  if (estate.kind === "cobol") return ingestEstate(ctx, log, repo, pack, estate);
  const r = await agent({
    cwd: repo, model: ctx.job.model, mode: "read", log, maxTurns: 60, toolbelt: toolbelt(ctx), modelProxy: modelProxy(ctx),
    append: "You are a member of the Accelerator crew. You never change files.",
    prompt: ingestInstruction(pack),
  });
  spent(ctx, r);
  if (!r.ok || !r.text.trim()) throw new Error(`The extractor stopped early (${r.reason ?? "no answer"}).`);
  return readIngest(r.text);
}

/** Tracked files with their line counts (members the adapter slices by size); data files are listed, never read. */
async function trackedFiles(repo: string) {
  const listed = await git("ls-files", repo);
  if (listed.code !== 0) throw new Error(`Couldn't list the repository: ${tail(listed.out, 200)}`);
  return listed.out.split(/\r?\n/).map((p) => p.trim()).filter(Boolean).slice(0, 50_000).map((path) => {
    const full = join(repo, path);
    const read = roleOf(path) !== "data" && existsSync(full) && statSync(full).size <= 2_000_000;
    return { path, lines: read ? readFileSync(full, "latin1").split("\n").length : 0 };
  });
}

/** A mainframe estate: one extractor per slice, then the Clerk and Gap Finder across them. A failed slice is logged, never fatal. */
async function ingestEstate(ctx: JobContext, log: Log, repo: string, pack: Pack, estate: ReturnType<typeof estateOf>): Promise<IngestReport> {
  const c = estate.counts;
  log.status(`surveyor> mainframe estate: ${c.program ?? 0} programs · ${c.copybook ?? 0} copybooks · ${c.job ?? 0} jobs · ${c.screen ?? 0} screens · ${c.transaction ?? 0} transaction files · ${c.data_definition ?? 0} data definitions`);
  log.status(`lead> ${estate.slices.length} slices, one extractor each, then reconciliation`);
  const reports: IngestReport[] = [];
  const direct = process.env.CRADLE_DIRECT_READ !== "off" ? directReader(repo, estate) : null;
  if (direct) log.status(`lead> each slice is read in one call on ${EXTRACT_MODEL()}${direct.sharedNames.size ? ` · ${direct.sharedNames.size} shared copybooks cached across slices` : ""}`);
  for (const [i, slice] of estate.slices.entries()) {
    log.status(`lead> slice ${i + 1}/${estate.slices.length} · ${slice.title} · ${slice.files.length} files · ${slice.lines} lines`);
    if (direct) {
      try {
        const report = await readSliceDirect(ctx, log, pack, estate, slice, i, direct);
        reports.push({ ...report, filesRead: slice.files.length });
        log.check(`judge> slice ${i + 1} read: ${report.candidates.length} policies · ${report.conflicts.length} contradictions`);
        continue;
      } catch (err) {
        log.check(`judge> slice ${i + 1}: the one-call read didn't work (${err instanceof Error ? err.message : String(err)}), so an agent reads it instead.`);
      }
    }
    const r = await agent({
      cwd: repo, model: ctx.job.model, mode: "read", log, maxTurns: 45, toolbelt: toolbelt(ctx), modelProxy: modelProxy(ctx),
      append: "You are a member of the Accelerator crew. You never change files.",
      prompt: ingestInstruction(pack, cobolSliceGuidance(estate, slice, i)),
    });
    spent(ctx, r);
    try {
      if (!r.ok || !r.text.trim()) throw new Error(r.reason ?? "no answer");
      const report = readIngest(r.text);
      reports.push({ ...report, filesRead: slice.files.length });
      log.check(`judge> slice ${i + 1} read: ${report.candidates.length} policies · ${report.conflicts.length} contradictions`);
    } catch (err) {
      log.check(`judge> slice ${i + 1} FAIL: ${err instanceof Error ? err.message : String(err)}. The other slices go on.`);
    }
  }
  if (!reports.length) throw new Error("No slice of the estate could be read.");
  return reconcile(ctx, log, repo, pack, mergeReports(reports), `${reports.length} of ${estate.slices.length} slices of a mainframe estate`);
}

// ── The direct read (B20): one call per slice instead of an agent loop ─────────

/** The model that reads each slice. Sonnet by default: extraction is judgment, not sorting. */
const EXTRACT_MODEL = () => process.env.CRADLE_EXTRACT_MODEL || "claude-sonnet-5-5";
/** Characters, not tokens (COBOL runs about 3 to 4 per token): the shared copybooks, and one slice with its own copybooks. */
const DIRECT_LIMIT = { shared: 300_000, slice: 600_000 };

type DirectReader = { repo: string; members: Map<string, string>; shared: string; sharedNames: Set<string> };

/**
 * Every copybook in the estate by member name, and the shared block: the
 * record copybooks (not the screen maps) sent once at the front of every call
 * and cached, so each slice after the first reads them at a tenth of the price.
 */
function directReader(repo: string, estate: ReturnType<typeof estateOf>): DirectReader {
  const members = new Map<string, string>();
  for (const dir of estate.copybookDirs) {
    let names: string[] = [];
    try {
      names = readdirSync(join(repo, dir));
    } catch {
      continue;
    }
    for (const f of names.sort()) {
      const name = f.replace(/\.[^.]+$/, "").toUpperCase();
      if (!members.has(name) && statSync(join(repo, dir, f)).isFile()) members.set(name, `${dir}/${f}`);
    }
  }
  const records = [...members.entries()].filter(([, path]) => !/bms/i.test(path));
  const blocks = records.map(([name, path]) => ({ name, text: numberedFile(path, readFileSync(join(repo, path), "latin1")) }));
  const size = blocks.reduce((n, b) => n + b.text.length, 0);
  if (!blocks.length || size > DIRECT_LIMIT.shared) return { repo, members, shared: "", sharedNames: new Set() };
  return {
    repo, members,
    shared: `The estate's shared copybooks (record layouts any slice may COPY):\n\n${blocks.map((b) => b.text).join("\n\n")}`,
    sharedNames: new Set(blocks.map((b) => b.name)),
  };
}

/** One slice in one call: its files and the copybooks they COPY (beyond the shared ones), line-numbered. */
async function readSliceDirect(ctx: JobContext, log: Log, pack: Pack, estate: ReturnType<typeof estateOf>, slice: ReturnType<typeof estateOf>["slices"][number], i: number, d: DirectReader): Promise<IngestReport> {
  const files = slice.files.map((path) => ({ path, text: readFileSync(join(d.repo, path), "latin1") }));
  const wanted = [...new Set(files.flatMap((f) => copyMembers(f.text)))].filter((n) => !d.sharedNames.has(n));
  const found = wanted.filter((n) => d.members.has(n));
  const missing = wanted.filter((n) => !d.members.has(n));
  const parts = [
    ...files.map((f) => numberedFile(f.path, f.text)),
    ...found.map((n) => numberedFile(d.members.get(n)!, readFileSync(join(d.repo, d.members.get(n)!), "latin1"))),
  ];
  if (missing.length) parts.push(`COPY members these files name that aren't in the estate's sources: ${missing.join(", ")}.`);
  const body = parts.join("\n\n");
  if (body.length > DIRECT_LIMIT.slice) throw new Error(`the slice is too large for one call (${Math.round(body.length / 1000)}k characters)`);
  const r = await read({
    model: EXTRACT_MODEL(), log, modelProxy: modelProxy(ctx),
    system: ingestInstruction(pack, cobolDirectGuidance(estate)),
    shared: d.shared,
    user: cobolDirectSlice(estate, slice, i, body),
  });
  spent(ctx, r);
  if (!r.ok) throw new Error(`the read stopped early (${r.reason})`);
  return readIngest(r.text);
}

/** The Clerk and Gap Finder across parts read separately (slices, or code sources): what no single part can see. */
async function reconcile(ctx: JobContext, log: Log, cwd: string, pack: Pack, merged: IngestReport, parts: string): Promise<IngestReport> {
  log.status(`clerk> reconciling ${merged.candidates.length} policies across ${parts}`);
  const r = await agent({
    cwd, model: ctx.job.model, mode: "read", log, maxTurns: 25, toolbelt: toolbelt(ctx), modelProxy: modelProxy(ctx),
    append: "You are a member of the Accelerator crew. You never change files.",
    prompt: reconcileInstruction(pack, merged),
  });
  spent(ctx, r);
  const found = r.ok ? readReconcile(r.text) : [];
  const seen = new Set(merged.conflicts.map((x) => [...x.keys].sort().join("|")));
  const conflicts = [...merged.conflicts, ...found.filter((x) => !seen.has([...x.keys].sort().join("|")))];
  return { ...merged, conflicts, summary: `Read in ${parts}: ${merged.candidates.length} policies, ${conflicts.length} contradictions. ${merged.summary}`.slice(0, 2000) };
}
