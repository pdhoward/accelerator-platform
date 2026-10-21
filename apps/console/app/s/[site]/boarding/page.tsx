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
      <Page>
        {data?.sample && (
        <p className="text-sm text-warn" data-sample>
          Sample: Example Machine Shop, an illustrative site. Every record here is synthetic; a real site shows its own.
        </p>
        )}
        {data ? <BoardingView siteId={site} initial={data} canAnswer={!data.sample && !staff && can("request.create")} canLog={!data.sample && can("request.create")} /> : <Note text={note ?? "Not available."} />}
      </Page>
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
