import { TimelineView } from "@/components/timeline-view";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Site Timeline" };

/** The Site Timeline (gen2-crew.md §18, G2.5): everything that happened on the site, from the Change Ledger. */
export default async function TimelinePage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ work?: string }> }) {
  const [{ site }, { work }] = await Promise.all([params, searchParams]);
  await siteAccess(site);
  const n = work ? Number(work) : undefined;
  const { data, note } = await load(async () => (await serverApi()).timeline(site, { work: n }));
  return (
    <>
      <PageHeader title="Site Timeline" sub={n ? `Work item #${n}: every decision, check and handoff, in order.` : "Every decision, check, handoff and change on this site, in order."} />
      <Page>{data ? <TimelineView siteId={site} initial={data} work={n} /> : <Note text={note ?? "Not available."} />}</Page>
    </>
  );
}

function Note({ text }: { text: string }) {
  return (
    <Card>
      <CardBody className="pt-5 text-[13.5px] text-fog">{text}</CardBody>
    </Card>
  );
}
