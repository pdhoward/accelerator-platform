import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { census, isCensusSource, readAssessment, type Census, type JobContext } from "@accelerator/domain";

import { secrets, type Log } from "./api";
import { probe, waitForDeployment } from "./deploys";
import { agent, chat, type Turn } from "./models";
import { buildAppend, buildPrompt, consultSystem, designSystem, planSystem, planText, transcript } from "./prompts";
import { changedFiles, checks, commitAll, ensureWorktree, git, headSha, isTestFile } from "./repo";
import { parseManifest, parseTests, scripts, sh, siteEnv, tail } from "./sh";

/** Development keys: the vault first, envmachine as the fallback during the switchover. */
const devEnv = async (ctx: JobContext) => ({ ...siteEnv(ctx.site.slug), ...(await secrets(ctx.job.id).then((r) => r.env).catch(() => ({}))) });

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
  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, `work-${w.number}`, w.branch ?? `work/${w.number}`, ctx.site.baseBranch);
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
    const r = await agent({ cwd: dir, model, append: system, mode: "read", log, prompt: `THE CONVERSATION SO FAR\n\n${transcript(w)}\n\n${instruction}` });
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
  let body = await think(ctx, log, designSystem(ctx), `Write the design document now.${note}${current}`);
  body = body.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m, "$1").trim();
  if (!body.startsWith("#")) body = body.slice(Math.max(0, body.indexOf("\n#") + 1)).trim() || body;
  return { kind: "design", body };
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
  if (!ctx.site.repoPath) throw new Error("This site has no repository connected yet (Setup → repository path).");
  if (ctx.job.provider !== "anthropic") throw new Error("Building needs a model with an agent harness (Claude at launch).");

  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, `work-${w.number}`, w.branch ?? `work/${w.number}`, ctx.site.baseBranch);
  const env = await devEnv(ctx);
  log.status(`Step ${step.position}: ${step.title}`);

  // Before: the suite as it stands, so the step can't shrink it.
  const before = await checks(dir, env);
  const testsBefore = before.test ? parseTests(before.test.out)?.total ?? null : null;
  log.check(`Before: ${testsBefore ?? "no"} tests`);
  const from = await headSha(dir);

  // A repair run: the crew re-runs a step the Protocol blocked, told exactly what failed (gen2-crew.md §17.4).
  const repair = Array.isArray(ctx.job.input.repairReasons) ? (ctx.job.input.repairReasons as unknown[]).map(String) : [];
  if (repair.length) log.status(`Repairing: ${repair.join(" ")}`);
  const r = await agent({ cwd: dir, model: ctx.job.model, append: buildAppend(ctx), mode: "build", log, prompt: buildPrompt(w, step, repair) });
  if (!r.ok) throw new Error(`The builder stopped early (${r.reason}).`);

  // After: the runner's own checks decide the verdict, not the model's report.
  log.status("Running the Protocol checks…");
  const after = await checks(dir, env);
  const typecheck = !after.typecheck || after.typecheck.code === 0;
  const tests = after.test ? parseTests(after.test.out) : null;
  log.check(`Typecheck: ${typecheck ? "clean" : "failed"}`, after.typecheck ? tail(after.typecheck.out) : undefined);
  log.check(tests ? `Tests: ${tests.passed}/${tests.total} passing` : "Tests: didn't run", after.test ? tail(after.test.out) : undefined);

  const commit = await commitAll(dir, `work #${w.number} step ${step.position}: ${step.title}`);
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
const gitRemote = (args: string, cwd: string) => sh(`git ${args}`, cwd, { GIT_TERMINAL_PROMPT: "0" }, 180_000);
const gitAs = (args: string, cwd: string) => sh(`git -c user.name="Accelerator Engine" -c user.email="engine@strategicmachines.ai" ${args}`, cwd, {}, 120_000);
const githubToken = (env: Record<string, string>) => process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || undefined;

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
  if (!ctx.site.repoPath) throw new Error("This site has no repository connected yet (Setup → repository path).");
  if (!ctx.site.repo) throw new Error("This site has no GitHub repository set (Setup → repository).");
  const branch = w.branch ?? `work/${w.number}`;
  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, `work-${w.number}`, branch, ctx.site.baseBranch);
  const env = await devEnv(ctx);

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

  const dir = await ensureWorktree(ctx.site.repoPath, ctx.site.slug, "release", "accelerator/release", base);
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
    items.push({ code: "C1", status: "failed", note: repo ? `${repo} isn't a git repository.` : "No repository connected yet (Setup → repository path)." });
  } else if ((await git("rev-parse --verify HEAD", repo)).code !== 0) {
    items.push({ code: "C1", status: "failed", note: "The repository has no commits yet. Commit the code, then run checkout again." });
  } else {
    // The base branch the engine builds from; create it locally from HEAD if it's missing.
    if ((await git(`rev-parse --verify --quiet refs/heads/${ctx.site.baseBranch}`, repo)).code !== 0) {
      const made = await git(`branch ${ctx.site.baseBranch}`, repo);
      log.tool(made.code === 0 ? `Created the ${ctx.site.baseBranch} branch from the current commit` : `Couldn't create ${ctx.site.baseBranch}: ${made.out}`);
    }
    const dir = await ensureWorktree(repo, ctx.site.slug, "checkout", `accelerator/checkout`, ctx.site.baseBranch);
    await git(`reset -q --hard ${ctx.site.baseBranch}`, dir);
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
