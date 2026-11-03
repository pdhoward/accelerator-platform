import { CradleGraph } from "@/components/cradle-graph";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Graph" };

/** The policy graph, drawn, at any moment in its history (gen3-cradle.md §2, §12). */
export default async function GraphPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [{ can }, api] = await Promise.all([siteAccess(site), serverApi()]);
  const { data, note } = await load(() => api.cradle.history(site));
  const history = data?.history ?? null;
  return (
    <>
      <PageHeader title="Graph" sub="Your policy graph: the business's concepts, its policies, the kernels that enforce them, the contradictions and your decisions. Drag the timeline to see it as it stood at any moment." />
      <Page>
        {history?.sample && (
          <p className="text-sm text-warn" data-sample>
            Sample: Example Machine Shop, from the simulated ingest on the Policy screen.
          </p>
        )}
        {history ? (
          <CradleGraph siteId={site} initial={history} canManage={can("config.manage")} />
        ) : (
          <Card><CardBody className="pt-5 text-[13.5px] text-fog">{note ?? "No graph yet. Start the cradle and ingest the site on the Policy screen; the graph grows from there."}</CardBody></Card>
        )}
      </Page>
    </>
  );
}
