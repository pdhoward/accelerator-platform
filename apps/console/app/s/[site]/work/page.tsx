import Link from "next/link";
import { ApiError } from "@accelerator/api-client";
import { RAIL_LABEL } from "@accelerator/domain";

import { Rail } from "@/components/flywheel";
import { NewWork } from "@/components/new-work";
import { Card, CardBody, Chip, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { day } from "@/lib/format";

export const metadata = { title: "Work" };

export default async function WorkPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const { can } = await siteAccess(site);
  const items = await (await serverApi()).work.list(site).catch((err) => {
    if (err instanceof ApiError && err.status === 503) return null;
    throw err;
  });

  return (
    <>
      <PageHeader title="Work" sub="Every body of work starts as a conversation, then moves along the rail: design, plan, build, prove, try, release." />
      <Page>
        {items === null ? (
          <Card>
            <CardBody className="pt-5 text-[13.5px] text-fog">Work items need the database. The local demo runs without one.</CardBody>
          </Card>
        ) : (
          <>
            {can("request.create") && <NewWork siteId={site} />}
            <Card>
              <CardBody className="flex flex-col divide-y divide-line pt-2">
                {items.length === 0 && <p className="py-4 text-[13.5px] text-mist">Nothing yet. Start with what you&apos;ve noticed.</p>}
                {items.map((w) => (
                  <Link key={w.id} href={`/s/${site}/work/${w.number}`} className="group flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                    <span className="w-10 font-mono text-[12px] text-mist">#{w.number}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium group-hover:text-cyan">{w.title}</span>
                      <span className="text-[12px] text-mist">Updated {day(w.updatedAt)}</span>
                    </span>
                    {w.kind === "install" ? (
                      <Chip tone="violet">Installation</Chip>
                    ) : (
                      <>
                        <Rail stage={w.stage} compact />
                        <Chip tone={w.stage === "done" ? "good" : "gold"}>{w.stage in RAIL_LABEL ? RAIL_LABEL[w.stage as keyof typeof RAIL_LABEL] : w.stage}</Chip>
                      </>
                    )}
                  </Link>
                ))}
              </CardBody>
            </Card>
          </>
        )}
      </Page>
    </>
  );
}
