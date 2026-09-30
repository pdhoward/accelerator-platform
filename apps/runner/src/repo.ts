import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { scripts, sh, type Run } from "./sh";

/**
 * The site's code, as the runner sees it: one git worktree per Work item on
 * its own branch, cut from the base branch. The client's working copy and
 * main are never touched.
 */
const root = () => process.env.RUNNER_WORKDIR ?? join(homedir(), ".accelerator", "worktrees");

export const git = (args: string, cwd: string) => sh(`git ${args}`, cwd, {}, 120_000);

export async function ensureWorktree(repoPath: string, slug: string, name: string, branch: string, base: string): Promise<string> {
  if (!existsSync(join(repoPath, ".git"))) throw new Error(`${repoPath} isn't a git repository.`);
  const dir = join(root(), slug, name);
  if (existsSync(join(dir, ".git"))) return dir;
  mkdirSync(join(root(), slug), { recursive: true });
  await git("worktree prune", repoPath);
  const hasBranch = (await git(`rev-parse --verify --quiet refs/heads/${branch}`, repoPath)).code === 0;
  const r = hasBranch ? await git(`worktree add "${dir}" ${branch}`, repoPath) : await git(`worktree add -b ${branch} "${dir}" ${base}`, repoPath);
  if (r.code !== 0) throw new Error(`Couldn't create the worktree: ${r.out.trim()}`);
  return dir;
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
