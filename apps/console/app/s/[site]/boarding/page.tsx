import { BoardingView } from "@/components/boarding-view";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Boarding" };

/** Boarding (gen2-crew.md §2.5, G2.6): Checkup → Connect → Survey → Interview → Assemble → Stabilize → Agreement. */
export default async function BoardingPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [{ can, staff }, api] = await Promise.all([siteAccess(site), serverApi()]);
  const { data, note } = await load(() => api.boarding.get(site));
  return (
    <>
      <PageHeader title="Boarding" sub="One guided flow to get the site ready. Each step is checked against the real records." />
      <Page>{data ? <BoardingView siteId={site} initial={data} canAnswer={!staff && can("request.create")} canLog={can("request.create")} /> : <Note text={note ?? "Not available."} />}</Page>
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
