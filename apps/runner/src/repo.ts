import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { githubRepo } from "@accelerator/domain";

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

export async function ensureWorktree(repoPath: string, slug: string, name: string, branch: string, base: string): Promise<string> {
  if (!existsSync(join(repoPath, ".git"))) throw new Error(`${repoPath} isn't a git repository.`);
  const dir = join(root(), slug, name);
  if (existsSync(join(dir, ".git"))) return dir;
  mkdirSync(join(root(), slug), { recursive: true });
  await git("worktree prune", repoPath);
  const hasBranch = (await git(`rev-parse --verify --quiet refs/heads/${branch}`, repoPath)).code === 0;
  const from = hasBranch ? base : await baseRef(repoPath, base);
  const r = hasBranch ? await git(`worktree add "${dir}" ${branch}`, repoPath) : await git(`worktree add -b ${branch} "${dir}" ${from}`, repoPath);
  if (r.code !== 0) throw new Error(`Couldn't create the worktree: ${r.out.trim()}`);
  return dir;
}

/**
 * Where new work starts: the local base branch, else GitHub's copy of it
 * (fetched), else a plain explanation. A missing base used to surface as
 * git's "invalid reference: stage".
 */
export async function baseRef(repoPath: string, base: string): Promise<string> {
  if ((await git(`rev-parse --verify --quiet refs/heads/${base}`, repoPath)).code === 0) return base;
  await gitRemote(`fetch --quiet origin ${base}`, repoPath);
  if ((await git(`rev-parse --verify --quiet refs/remotes/origin/${base}`, repoPath)).code === 0) {
    await git(`branch --track ${base} origin/${base}`, repoPath);
    return base;
  }
  throw new Error(`The site's base branch "${base}" doesn't exist here or on GitHub. Create it from main (git branch ${base} main && git push -u origin ${base}), or change the base branch in Setup.`);
}

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

/** install · typecheck · test, as the site defines them. */
export async function checks(dir: string, env: Record<string, string>) {
  const s = scripts(dir);
  const install = existsSync(join(dir, "node_modules")) ? null : await sh("pnpm install --frozen-lockfile --prefer-offline", dir, env);
  const typecheck: Run | null = s.typecheck ? await sh("pnpm typecheck", dir, env) : await sh("npx tsc --noEmit", dir, env);
  const test: Run | null = s.test ? await sh("pnpm test", dir, env) : null;
  return { install, typecheck, test };
}
