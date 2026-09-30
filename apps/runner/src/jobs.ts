import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobContext } from "@accelerator/domain";

import { secrets, type Log } from "./api";
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

export async function discuss(ctx: JobContext, log: Log) {
  const reply = await think(ctx, log, consultSystem(ctx), "Reply to the Navigator's latest message.");
  return { kind: "discuss", reply };
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

  const r = await agent({ cwd: dir, model: ctx.job.model, append: buildAppend(ctx), mode: "build", log, prompt: buildPrompt(w, step) });
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
  }

  // What needs GitHub + Vercel + a test database is waiting on Install, and says so.
  items.push({ code: "C2", status: "waiting", note: "Needs the GitHub App and Vercel (I1, I3). Until then, work stays on local branches." });
  items.push({ code: "C3", status: "waiting", note: "Needs the test database (I5)." });
  items.push({ code: "C5", status: "waiting", note: "Proven once the GitHub App and branch protection are in (I1, I2)." });
  return { kind: "checkout", items, baselineTests, manifest };
}
