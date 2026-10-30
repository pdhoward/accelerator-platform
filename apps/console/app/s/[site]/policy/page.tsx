import { isDomain } from "@accelerator/domain";

import { CradleView } from "@/components/cradle-view";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Policy" };

/** Gen 3, the Cradle (gen3-cradle.md): the site's app as a policy book, with the crew that reads, checks and tends it. */
export default async function PolicyPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [{ can, membership }, api] = await Promise.all([siteAccess(site), serverApi()]);
  const { data, note } = await load(() => api.cradle.get(site));
  const record = membership?.sites.find((s) => s.slug === site);
  // The sample mirrors the real Machine Shop, which the demo story is drawn from.
  const siteUrl = data?.sample ? "https://strategic-machineshop.vercel.app" : record?.url ?? null;
  return (
    <>
      <PageHeader title="Policy" sub="Your app as the policies, practices and rules it carries out. The crew finds them, checks them and keeps them; you rule." />
      <Page>
        {data?.sample && (
          <p className="text-sm text-warn" data-sample>
            Sample: Example Machine Shop. The ingest is simulated from a real reading of Machine Shop's code; a real site runs it on the crew's runner.
          </p>
        )}
        {data ? (
          <CradleView siteId={site} initial={data} canManage={can("config.manage")} siteUrl={siteUrl} defaultPack={isDomain(data.pack?.id) ? data.pack!.id : null} />
        ) : (
          <Card><CardBody className="pt-5 text-[13.5px] text-fog">{note ?? "Not available."}</CardBody></Card>
        )}
      </Page>
    </>
  );
}
