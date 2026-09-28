import { serverApi } from "@/lib/api";
import { EngineerOnly, ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, CardHead, Chip, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Data Desk" };

export default async function DataDeskPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const { investigations, checks } = await serverApi().dataDesk(site);

  return (
    <>
      <PageHeader title="Data Desk" sub="Questions about your data, answered read-only first. Fixes are previewed row by row and need your approval." />
      <Page>
        {investigations.map((inv) => (
          <div key={inv.id} className="flex flex-col gap-4">
            <Card className="p-5">
              <Eyebrow>Request #{inv.requestNumber} · from {inv.askedBy}</Eyebrow>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">&ldquo;{inv.question}&rdquo;</h2>
              <p className="text-[13px] text-fog">The engine investigated with read-only access. Nothing has been changed.</p>
            </Card>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHead title="What it found">
                  <Chip tone="good">Read-only</Chip>
                </CardHead>
                <CardBody className="flex flex-col gap-3">
                  <p className="text-[13.5px]">{inv.summary}</p>
                  <ul className="flex flex-col gap-2">
                    {inv.findings.map((f) => (
                      <li key={f.text} className="flex gap-2.5 text-[13px]">
                        <span className={f.flag === "ok" ? "text-good" : "text-warn"}>{f.flag === "ok" ? "✓" : "!"}</span>
                        {f.text}
                      </li>
                    ))}
                  </ul>
                  <EngineerOnly>
                    <div className="rounded-xl border border-dashed border-line-2 bg-panel-2 px-3 py-2 font-mono text-xs text-fog">{inv.engineer}</div>
                  </EngineerOnly>
                </CardBody>
              </Card>
              <Card>
                <CardHead title="Proposed fix">
                  <Chip tone="warn">Money · needs your approval</Chip>
                </CardHead>
                <CardBody className="flex flex-col gap-3">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                          <th className="px-2 py-2 font-medium">Record</th>
                          <th className="px-2 py-2 font-medium">Now</th>
                          <th className="px-2 py-2 font-medium">After fix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.proposedFix.map((row) => (
                          <tr key={row.record} className="border-b border-line last:border-0">
                            <td className="px-2 py-2.5">{row.record}</td>
                            <td className="px-2 py-2.5 text-fog">{row.now}</td>
                            <td className="px-2 py-2.5 text-good">{row.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col gap-2.5 rounded-xl border border-warn/45 bg-warn/10 p-3.5">
                    <b className="text-[13px]">Before you approve</b>
                    <span className="text-[13px] text-fog">{inv.affects}</span>
                    <div className="flex flex-wrap gap-2">
                      <ToastButton className={button("gold")} message="Approved. The fix runs on a copy first, then on the live data. The report updates when it's done.">
                        Approve fix
                      </ToastButton>
                      <ToastButton className={button("plain")} message="Ask anything. The engine answers with the rows behind its answer.">
                        Ask a question
                      </ToastButton>
                      <ToastButton className={button("ghost")} message="Kept as is. The finding is saved in the Library.">
                        It&apos;s real, keep it
                      </ToastButton>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
        ))}

        <Card>
          <CardHead title="Standing data checks" hint="Run every morning; problems appear on the Bridge" />
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                  <th className="px-2 py-2 font-medium">Check</th>
                  <th className="px-2 py-2 font-medium">Last run</th>
                  <th className="px-2 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-2 py-2.5">{c.name}</td>
                    <td className="px-2 py-2.5 font-mono text-mist">{c.lastRun}</td>
                    <td className="px-2 py-2.5">
                      <Chip tone={c.result === "pass" ? "good" : c.result === "warn" ? "warn" : "bad"}>
                        {c.result === "pass" ? "Pass" : "Found"} · {c.detail}
                      </Chip>
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
