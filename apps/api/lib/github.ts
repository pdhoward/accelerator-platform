import type { FileNode } from "@accelerator/domain";

import { CodeError } from "./codes";
import { secretValues } from "./vault";

/**
 * The site's real repository, read through GitHub's API: the whole tree and
 * any file, at full depth. Private repos use the site's GITHUB_TOKEN from the
 * vault (engine keys) until our GitHub App is installed.
 */
type Site = { id: string; repo: string; baseBranch?: string };

async function token(siteId: string) {
  return (await secretValues(siteId, "engine").catch(() => ({}) as Record<string, string>)).GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
}

async function gh<T>(path: string, t: string | undefined, accept = "application/vnd.github+json"): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept, "x-github-api-version": "2022-11-28", ...(t && { authorization: `Bearer ${t}` }) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (res.status === 404) throw new CodeError(t ? "GitHub can't find that repository or file with the site's token." : "GitHub can't see this repository. If it's private, add GITHUB_TOKEN under Configuration → Engine keys.");
  if (res.status === 401 || res.status === 403) throw new CodeError("GitHub refused the site's token. Check it has Contents: read on this repository.");
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return (accept.includes("raw") ? await res.text() : await res.json()) as T;
}

const repoOf = (site: Site) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(site.repo ?? "")) throw new CodeError("No GitHub repository set for this site yet (Setup → GitHub repository).");
  return site.repo;
};

/** The base branch if it exists on GitHub, else the repository's default branch. */
async function branch(site: Site, t: string | undefined) {
  const repo = repoOf(site);
  if (site.baseBranch) {
    const ok = await fetch(`https://api.github.com/repos/${repo}/branches/${site.baseBranch}`, {
      headers: { accept: "application/vnd.github+json", ...(t && { authorization: `Bearer ${t}` }) },
      cache: "no-store",
    });
    if (ok.ok) return site.baseBranch;
  }
  return (await gh<{ default_branch: string }>(`/repos/${repo}`, t)).default_branch;
}

/** GitHub's flat recursive tree → nested folders first, then files, alphabetical. */
export function nestTree(entries: { path: string; type: string }[]): FileNode[] {
  const root: FileNode[] = [];
  const dirs = new Map<string, FileNode>();
  const sorted = [...entries].filter((e) => e.type === "tree" || e.type === "blob").sort((a, b) => a.path.localeCompare(b.path));
  for (const e of sorted) {
    const cut = e.path.lastIndexOf("/");
    const parent = cut < 0 ? root : dirs.get(e.path.slice(0, cut))?.children;
    if (!parent) continue;
    const node: FileNode = { name: e.path.slice(cut + 1), path: e.path, type: e.type === "tree" ? "dir" : "file", ...(e.type === "tree" && { children: [] }) };
    parent.push(node);
    if (node.type === "dir") dirs.set(e.path, node);
  }
  const order = (list: FileNode[]) => {
    list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    for (const n of list) if (n.children) order(n.children);
    return list;
  };
  return order(root);
}

export async function repoTree(site: Site): Promise<FileNode[]> {
  const t = await token(site.id);
  const ref = await branch(site, t);
  const data = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(`/repos/${repoOf(site)}/git/trees/${encodeURIComponent(ref)}?recursive=1`, t);
  return nestTree(data.tree);
}

export async function repoFile(site: Site, path: string): Promise<string> {
  if (path.includes("..") || /(^|\/)\.env(?!\.example$)/.test(path)) throw new CodeError("That file isn't shown here.");
  const t = await token(site.id);
  const ref = await branch(site, t);
  return gh<string>(`/repos/${repoOf(site)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, t, "application/vnd.github.raw");
}
