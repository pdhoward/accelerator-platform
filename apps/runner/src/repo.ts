import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { githubRepo } from "@accelerator/domain";

import type { Log } from "./api";
import { scripts, sh, tail, type Run } from "./sh";

/**
 * The site's code, as the runner sees it: one git worktree per Work item on
 * its own branch, cut from the base branch. The client's working copy and
 * main are never touched.
 */
const root = () => process.env.RUNNER_WORKDIR ?? join(homedir(), ".accelerator", "worktrees");

export const git = (args: string, cwd: string) => sh(`git ${args}`, cwd, {}, 120_000);

/** Where the runner keeps code it cloned itself (a hosted runner has no local copies). */
const clones = () => process.env.RUNNER_REPOS ?? join(homedir(), ".accelerator", "repos");

/**
 * Git's GitHub credentials, as environment only: never on the command line
 * or in .git/config. The token rides as an HTTP header to github.com alone.
 * Without a token, public repositories still clone.
 */
export function githubAuthEnv(token: string | undefined): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
  if (!token) return env;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}` };
}

/** Commands that reach GitHub (fetch, push), with the runner's token when it has one. */
export const gitRemote = (args: string, cwd: string) => sh(`git ${args}`, cwd, githubAuthEnv(process.env.GITHUB_TOKEN || undefined), 180_000);

/**
 * Where a system's code is: its local copy when this machine has one, else
 * the runner's own clone of its GitHub repository. Null when neither exists.
 */
export function codeHome(localPath: string | null | undefined, repo: string | null | undefined, has: (dir: string) => boolean = (d) => existsSync(join(d, ".git"))): { dir: string; clone: string | null } | null {
  if (localPath?.trim() && has(localPath.trim())) return { dir: localPath.trim(), clone: null };
  const gh = githubRepo(repo);
  return gh ? { dir: join(clones(), gh.replace("/", "__")), clone: gh } : null;
}

/**
 * Clone once; on later jobs, bring the clone to GitHub's default branch. Only
 * the runner's own clone is ever reset: a local copy is never touched, and
 * Work items have their own worktrees. Nothing in the repository is run.
 */
export async function ensureClone(gh: string, dir: string, token: string | undefined): Promise<"cloned" | "updated"> {
  const env = githubAuthEnv(token);
  if (existsSync(join(dir, ".git"))) {
    const f = await sh("git fetch --quiet --prune origin", dir, env, 10 * 60_000);
    if (f.code !== 0) throw new Error(`Couldn't update the clone of ${gh}: ${tail(f.out, 300)}`);
    await sh("git remote set-head origin --auto", dir, env, 120_000);
    const r = await git("reset -q --hard origin/HEAD", dir);
    if (r.code !== 0) throw new Error(`Couldn't update the clone of ${gh}: ${tail(r.out, 300)}`);
    return "updated";
  }
  mkdirSync(clones(), { recursive: true });
  const r = await sh(`git -c core.longpaths=true clone --quiet https://github.com/${gh}.git "${dir}"`, clones(), env, 30 * 60_000);
  if (r.code !== 0) throw new Error(`Couldn't clone ${gh} from GitHub: ${tail(r.out, 300)}${token ? "" : " If the repository is private, give the runner a GITHUB_TOKEN."}`);
  return "cloned";
}

/** What the runner checked about a working copy, said to the crew so they never reason from stale code. */
const states = new Map<string, string>();
export const codeState = (dir: string) => states.get(dir) ?? "";

const count = async (range: string, cwd: string) => Number((await git(`rev-list --count ${range}`, cwd)).out.trim()) || 0;
const short = async (ref: string, cwd: string) => (await git(`log -1 --format=%h·%s ${ref}`, cwd)).out.trim().slice(0, 90);

/**
 * How a Work branch meets its base. The runner, not the operator, keeps work
 * on current code: a branch with nothing of its own moves up; one with its
 * own commits takes the base in by a merge; one already current is left.
 */
export function syncPlan(behind: number, own: number): "current" | "fast-forward" | "merge" {
  return behind === 0 ? "current" : own === 0 ? "fast-forward" : "merge";
}

/**
 * The working copy for a Work item (or a release or checkout), checked before
 * every job (the code-state practice): the base is GitHub's when the local one
 * is behind; the branch is brought up to the base; leftovers are reported.
 * `sync: false` is for worktrees the job resets itself.
 */
export async function ensureWorktree(repoPath: string, slug: string, name: string, branch: string, base: string, opts: { log?: Log; sync?: boolean } = {}): Promise<string> {
  if (!existsSync(join(repoPath, ".git"))) throw new Error(`${repoPath} isn't a git repository.`);
  const { log, sync = true } = opts;
  const dir = join(root(), slug, name);
  const b = await baseState(repoPath, base);
  if (!b.fetched) log?.check(`code> couldn't reach GitHub for ${base}; working from this machine's copy, which may be out of date.`);
  else if (b.localBehind) log?.status(`code> this machine's ${base} is ${b.localBehind} commit(s) behind GitHub; work starts from GitHub's (the local branch is left as it is).`);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(join(root(), slug), { recursive: true });
    await git("worktree prune", repoPath);
    const hasBranch = (await git(`rev-parse --verify --quiet refs/heads/${branch}`, repoPath)).code === 0;
    const r = hasBranch ? await git(`worktree add "${dir}" ${branch}`, repoPath) : await git(`worktree add -b ${branch} "${dir}" ${b.ref}`, repoPath);
    if (r.code !== 0) throw new Error(`Couldn't create the worktree: ${r.out.trim()}`);
  }
  const leftovers = (await git("status --porcelain", dir)).out.trim();
  if (leftovers) log?.check(`code> the working copy has ${leftovers.split("\n").length} uncommitted change(s) left from an earlier run; they are kept.`);
  if (sync) {
    const behind = await count(`HEAD..${b.ref}`, dir);
    const own = await count(`${b.ref}..HEAD`, dir);
    const plan = syncPlan(behind, own);
    if (plan === "fast-forward") {
      const r = await git(`merge --ff-only --quiet ${b.ref}`, dir);
      if (r.code !== 0) throw new Error(`The branch is ${behind} commit(s) behind ${base} and couldn't catch up: ${tail(r.out, 300)}`);
      log?.status(`code> ${branch} caught up with ${base} (+${behind} commits)`);
    } else if (plan === "merge") {
      const r = await sh(`git -c user.name="Accelerator Engine" -c user.email="engine@strategicmachines.ai" merge --no-edit --quiet ${b.ref}`, dir, {}, 120_000);
      if (r.code !== 0) {
        const files = (await git("diff --name-only --diff-filter=U", dir)).out.trim().split(/\r?\n/).filter(Boolean);
        await git("merge --abort", dir);
        throw new Error(`${branch} has ${own} change(s) of its own and is ${behind} behind ${base}; taking ${base} in conflicts in ${files.join(", ") || "some files"}. The crew won't work on stale code: resolve the conflict, or cancel and restart the Work item.`);
      }
      log?.status(`code> took ${behind} new commit(s) from ${base} into ${branch} (it keeps its own ${own})`);
    }
  }
  const head = await short("HEAD", dir);
  states.set(dir, [
    `CODE STATE (the runner checked this just before you started; trust it):`,
    `- You are on ${branch} at ${head}.`,
    `- ${sync ? `It includes everything on ${base} as of GitHub's ${await short(b.ref, dir)}.` : `${base} on GitHub is at ${await short(b.ref, dir)}.`}`,
    `- If the code doesn't contain what the Work item or the conversation assumes, say so plainly as a premise mismatch, naming what you expected and where you looked. Don't change course on it alone.`,
  ].join("\n"));
  return dir;
}

/** The base branch: GitHub's copy when the local one is only behind it, else the local one. The local branch is never moved. */
async function baseState(repoPath: string, base: string): Promise<{ ref: string; fetched: boolean; localBehind: number }> {
  const fetched = (await gitRemote(`fetch --quiet origin ${base}`, repoPath)).code === 0;
  const local = (await git(`rev-parse --verify --quiet refs/heads/${base}`, repoPath)).code === 0;
  const remote = (await git(`rev-parse --verify --quiet refs/remotes/origin/${base}`, repoPath)).code === 0;
  if (remote && (!local || (await git(`merge-base --is-ancestor ${base} origin/${base}`, repoPath)).code === 0)) {
    return { ref: `origin/${base}`, fetched, localBehind: local ? await count(`${base}..origin/${base}`, repoPath) : 0 };
  }
  if (local) return { ref: base, fetched, localBehind: 0 };
  throw new Error(`The site's base branch "${base}" doesn't exist here or on GitHub. Create it from main (git branch ${base} main && git push -u origin ${base}), or change the base branch in Setup.`);
}

export const baseRef = async (repoPath: string, base: string) => (await baseState(repoPath, base)).ref;

export const headSha = async (dir: string) => (await git("rev-parse HEAD", dir)).out.trim();

/** Commit whatever the step changed (the runner commits, not the model). */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git("add -A", dir);
  if ((await git("diff --cached --quiet", dir)).code === 0) return null;
  const r = await sh(`git -c user.name="Accelerator Engine" -c user.email="engine@strategicmachines.ai" commit -q -m ${JSON.stringify(message)}`, dir);
  if (r.code !== 0) throw new Error(`Commit failed: ${r.out.trim()}`);
  return headSha(dir);
}

export async function changedFiles(dir: string, from: string): Promise<string[]> {
  return (await git(`diff --name-only ${from} HEAD`, dir)).out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export const isTestFile = (f: string) => /(\.|\/)(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)(__tests__|tests?)\//.test(f);

/**
 * The last proof the runner ran on a worktree (B33): the commit it checked and the test count. A step that
 * starts on that same commit, with nothing uncommitted, reuses it as its "before" instead of running the
 * whole suite again. Kept in the worktree's own git folder, so it never reaches the site's repository.
 */
const proofFile = async (dir: string) => join((await git("rev-parse --absolute-git-dir", dir)).out.trim(), "accelerator-proof.json");

export async function lastProof(dir: string): Promise<{ tests: number | null } | null> {
  try {
    if ((await git("status --porcelain", dir)).out.trim()) return null;
    const p = JSON.parse(readFileSync(await proofFile(dir), "utf8")) as { sha?: string; tests?: number | null };
    return p.sha && p.sha === (await headSha(dir)) ? { tests: p.tests ?? null } : null;
  } catch {
    return null;
  }
}

export async function saveProof(dir: string, tests: number | null) {
  try {
    writeFileSync(await proofFile(dir), JSON.stringify({ sha: await headSha(dir), tests, at: new Date().toISOString() }));
  } catch {
    // Only an optimisation: without the record, the next step runs its own "before".
  }
}

/** install · typecheck · test, as the site defines them. */
export async function checks(dir: string, env: Record<string, string>) {
  const s = scripts(dir);
  const install = existsSync(join(dir, "node_modules")) ? null : await sh("pnpm install --frozen-lockfile --prefer-offline", dir, env);
  const typecheck: Run | null = s.typecheck ? await sh("pnpm typecheck", dir, env) : await sh("npx tsc --noEmit", dir, env);
  const test: Run | null = s.test ? await sh("pnpm test", dir, env) : null;
  return { install, typecheck, test };
}
