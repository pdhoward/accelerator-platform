import Link from "next/link";

import { SiteInventory } from "@/components/site-inventory";
import { button, Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Site" };

/** Site (gen2-crew.md §10.4): the capability inventory, its condition and the changes in flight; technical maps behind Engineer view. */
export default async function SitePage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [{ can }, api] = await Promise.all([siteAccess(site), serverApi()]);
  const { data, note } = await load(() => api.capabilities.get(site));
  return (
    <>
      <PageHeader title="Site" sub="What the site does for the business: each capability's condition, and the changes in flight.">
        <Link href={`/s/${site}/timeline`} className={button("plain")}>Site Timeline</Link>
      </PageHeader>
      <Page>
        {data?.sample && (
        <p className="text-sm text-warn" data-sample>
          Sample: Example Machine Shop, an illustrative site. Every record here is synthetic; a real site shows its own.
        </p>
        )}
        {data ? <SiteInventory siteId={site} initial={data} canManage={!data.sample && can("config.manage")} /> : <Note text={note ?? "Not available."} />}
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
