import { CrewView } from "@/components/crew-view";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Crew & Knowledge" };

/** Crew & Knowledge (gen2-crew.md §2.4, §10.4): the Team Lead and crew, what they know, learning proposals, Library and export. */
export default async function CrewPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [{ can, staff }, api] = await Promise.all([siteAccess(site), serverApi()]);
  const { data, note } = await load(async () => {
    const crew = await api.crew.get(site);
    // The keyless demo has the catalog but no proposals (they're records).
    const proposals = crew.sample ? [] : await api.crew.proposals(site);
    return { crew, proposals };
  });
  return (
    <>
      <PageHeader title="Crew & Knowledge" sub="Your Team Lead and crew, what they know, what they've learned, and the record." />
      <Page>
        {data ? (
          <CrewView
            siteId={site}
            initial={data.crew}
            initialProposals={data.proposals}
            can={data.crew.sample ? { configure: false, decide: false, propose: false, export: false, engineer: false } : { configure: can("config.manage"), decide: can("skills.manage") && !staff, propose: can("request.create"), export: can("config.manage"), engineer: false }}
          />
        ) : (
          <Note text={note ?? "Not available."} />
        )}
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
