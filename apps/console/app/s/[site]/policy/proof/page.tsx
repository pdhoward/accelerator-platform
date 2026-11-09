import Link from "next/link";

import { ProofScorecard } from "@/components/proof-scorecard";
import { button, Card, CardBody, Page, PageHeader } from "@/components/ui";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Proof scorecard" };

/** The proof scorecard (gen3-cradle.md B7): the conformance gate's evidence, for the site owner. */
export default async function ProofPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const api = await serverApi();
  const { data, note } = await load(() => api.cradle.scorecard(site));
  return (
    <>
      <PageHeader title="Proof scorecard" sub="How well the running app is proven against your rules: what passes, what's unreliable and why, what no test covers yet, and what proving has cost." />
      <Page>
        <div><Link href={`/s/${site}/policy`} className={button("ghost")}>Back to Policy</Link></div>
        {data ? (
          <ProofScorecard score={data} site={site} />
        ) : (
          <Card><CardBody className="pt-5 text-[13.5px] text-fog">{note ?? "This site has no cradle yet, so there is nothing to prove."}</CardBody></Card>
        )}
      </Page>
    </>
  );
}
