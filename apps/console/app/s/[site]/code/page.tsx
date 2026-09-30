import Link from "next/link";
import { ApiError } from "@accelerator/api-client";
import type { FileNode } from "@accelerator/domain";

import { serverApi } from "@/lib/api";
import { CodeBrowser } from "@/components/code-browser";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Code" };

/** A sensible first file: the README, else the rulebook, else the first file in the tree. */
function firstFile(tree: FileNode[]): string {
  const top = tree.map((n) => n.path);
  for (const want of ["README.md", "CLAUDE.md", "package.json"]) if (top.includes(want)) return want;
  const walk = (nodes: FileNode[]): string | null => {
    for (const n of nodes) {
      if (n.type === "file") return n.path;
      const inner = n.children && walk(n.children);
      if (inner) return inner;
    }
    return null;
  };
  return walk(tree) ?? "";
}

/** Engineer view: the site's real repository, full depth. Hidden from the nav unless Engineer view is on. */
export default async function CodePage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const result = await (await serverApi()).code.tree(site).then(
    (tree) => ({ tree }),
    (err) => ({ error: err instanceof ApiError ? err.message : "Couldn't read the repository." }),
  );

  return (
    <>
      <PageHeader title="Code" sub="Engineer view: the site's repository. Changes still go through the loop, so every edit gets tested and gated." />
      <Page>
        {"tree" in result ? (
          <CodeBrowser siteId={site} tree={result.tree} initialPath={firstFile(result.tree)} />
        ) : (
          <Card>
            <CardBody className="flex flex-col gap-2 pt-5 text-[13.5px]">
              <p className="text-warn">{result.error}</p>
              <p className="text-fog">
                Set the repository on <Link href={`/s/${site}/setup`} className="text-cyan hover:underline">Setup</Link>, and for a private repository add a
                read-only <span className="font-mono">GITHUB_TOKEN</span> under <Link href={`/s/${site}/config`} className="text-cyan hover:underline">Configuration → Engine keys</Link>.
              </p>
            </CardBody>
          </Card>
        )}
      </Page>
    </>
  );
}
