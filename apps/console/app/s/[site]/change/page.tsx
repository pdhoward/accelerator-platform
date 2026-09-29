import Link from "next/link";
import { redirect } from "next/navigation";
import { STAGE_LABEL } from "@accelerator/domain";

import { serverApi } from "@/lib/api";
import { Card, CardBody, Chip, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Change Room" };

/** Opens the change waiting on a person; otherwise lists every change. */
export default async function ChangeIndexPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const changes = await (await serverApi()).changes.list(site);
  const waiting = changes.find((c) => c.stage === "try") ?? changes.find((c) => c.stage === "ship");
  if (waiting) redirect(`/s/${site}/change/${waiting.id}`);

  return (
    <>
      <PageHeader title="Change Room" sub="Nothing is waiting for you right now." />
      <Page>
        <Card>
          <CardBody className="flex flex-col gap-2">
            {changes.length === 0 && <p className="text-[13px] text-fog">No changes yet. Send a request and the engine will start one.</p>}
            {changes.map((c) => (
              <Link key={c.id} href={`/s/${site}/change/${c.id}`} className="flex items-center justify-between rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-[13px] hover:border-line-2">
                <span>#{c.requestNumber} {c.title}</span>
                <Chip>{STAGE_LABEL[c.stage]}</Chip>
              </Link>
            ))}
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
