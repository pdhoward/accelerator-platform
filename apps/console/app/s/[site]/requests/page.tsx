import Link from "next/link";
import { STAGE_LABEL } from "@accelerator/domain";

import { serverApi } from "@/lib/api";
import { RequestCapture } from "@/components/request-capture";
import { Card, CardBody, CardHead, Chip, cx, Page, PageHeader, STAGE_DOT } from "@/components/ui";

export const metadata = { title: "Requests" };

const RISK_TONE = { money: "warn", data: "warn", auth: "warn", security: "warn", code: "default", display: "default", content: "good" } as const;
const PRIORITIES = ["now", "next", "later"] as const;

export default async function RequestsPage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ p?: string }> }) {
  const { site } = await params;
  const { p } = await searchParams;
  const all = await serverApi().requests.list(site);
  const filter = PRIORITIES.find((x) => x === p);
  const rows = filter ? all.filter((r) => r.priority === filter) : all;

  return (
    <>
      <PageHeader title="Requests" sub="Everything anyone wants changed, triaged by the engine. Numbers are permanent." />
      <Page>
        <RequestCapture siteId={site} />
        <Card>
          <CardHead title="Backlog">
            <nav className="inline-flex rounded-lg border border-line p-0.5" aria-label="Filter by priority">
              {[undefined, ...PRIORITIES].map((x) => (
                <Link
                  key={x ?? "all"}
                  href={x ? `?p=${x}` : "?"}
                  aria-current={filter === x ? "page" : undefined}
                  className={cx("rounded-md px-3 py-1 text-[12.5px] capitalize", filter === x ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-fog")}
                >
                  {x ?? "All"}
                </Link>
              ))}
            </nav>
          </CardHead>
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Request</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Risk</th>
                  <th className="px-3 py-2.5 font-medium">Priority</th>
                  <th className="px-3 py-2.5 font-medium">From</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-3 font-mono text-mist">{r.number}</td>
                    <td className="px-3 py-3">
                      {r.changeId ? (
                        <Link href={`/s/${site}/change/${r.changeId}`} className="font-medium hover:text-cyan">
                          {r.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{r.title}</span>
                      )}
                      <div className="text-xs text-mist">{r.detail}</div>
                    </td>
                    <td className="px-3 py-3"><Chip className="capitalize">{r.type}</Chip></td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.risk.map((k) => <Chip key={k} tone={RISK_TONE[k]} className="capitalize">{k}</Chip>)}
                      </div>
                    </td>
                    <td className="px-3 py-3 capitalize text-fog">{r.priority}</td>
                    <td className="px-3 py-3 text-mist">{r.source}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fog">
                        <i className={cx("size-1.5 rounded-full", STAGE_DOT[r.stage])} />
                        {r.note ?? STAGE_LABEL[r.stage]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
