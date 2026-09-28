import { serverApi } from "@/lib/api";
import { CodeBrowser } from "@/components/code-browser";
import { Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Code" };

/** Engineer view: the repository with an embedded editor. Hidden from the nav unless Engineer view is on. */
export default async function CodePage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const tree = await serverApi().code.tree(site);

  return (
    <>
      <PageHeader title="Code" sub="Engineer view: the site's repository. Changes still go through the loop, so every edit gets tested and gated." />
      <Page>
        <CodeBrowser siteId={site} tree={tree} initialPath="packages/domain/src/reports/folio-report.ts" />
      </Page>
    </>
  );
}
