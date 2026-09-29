import { notFound } from "next/navigation";
import { canApprove, requiredGates } from "@accelerator/domain";
import { ApiError } from "@accelerator/api-client";

import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { Compare } from "@/components/compare";
import { TryPanel } from "@/components/try-panel";
import { EngineerOnly, ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Change Room" };

const GATE_LABEL = { try: "Someone tries it", "owner-approval": "Owner approves", "data-preview": "Data preview" } as const;

export default async function ChangeRoomPage({ params }: { params: Promise<{ site: string; changeId: string }> }) {
  const { site, changeId } = await params;
  const change = await (await serverApi())
    .changes.get(site, changeId)
    .catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    });
  const gates = requiredGates(change);
  const { role } = await siteAccess(site);

  return (
    <>
      <PageHeader title={change.title} sub={`Change for request #${change.requestNumber} · see it, check the evidence, try it, approve.`}>
        <Chip tone={change.stage === "ship" ? "good" : "cyan"}>{change.stage === "ship" ? "Approved: ready to go live" : "Your turn: Try"}</Chip>
        <Chip>
          {change.risk.join(" · ")} · {change.level}
        </Chip>
        <Chip tone="good">Evidence green</Chip>
      </PageHeader>
      <Page>
        <div className="grid items-start gap-4 xl:grid-cols-[0.95fr_1.25fr_0.9fr]">
          <Card>
            <CardHead title="Conversation" hint="Decisions are recorded in the Library" />
            <CardBody className="flex flex-col gap-3">
              {change.conversation.map((m, i) => (
                <div
                  key={i}
                  className={cx(
                    "flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed",
                    m.from === "human" && "border-line bg-panel-2",
                    m.from === "engine" && "border-violet/25 bg-violet/10",
                    m.from === "decision" && "border-gold/45",
                  )}
                >
                  <span className="text-[11.5px] text-mist">
                    {m.from === "decision" ? `Decision recorded · ${m.author}` : `${m.author} · ${m.at}`}
                  </span>
                  {m.text}
                  {m.bullets && (
                    <ol className="list-decimal pl-5">
                      {m.bullets.map((b) => <li key={b}>{b}</li>)}
                    </ol>
                  )}
                </div>
              ))}
              <div className="flex gap-2">
                <label htmlFor="reply" className="sr-only">Reply to the engine</label>
                <input id="reply" placeholder="Ask or answer…" className="min-w-0 flex-1 rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-ink placeholder:text-mist focus:border-violet focus:outline-none" />
                <ToastButton className={button("plain")} message="Sent. The engine replies here, usually within a minute.">Send</ToastButton>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="The change" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-[13px] text-fog">{change.summary}</p>
              <Compare before={change.before} after={change.after} />
              <div className="flex flex-wrap gap-2">
                {change.alsoChanges.map((x) => <Chip key={x}>Also changes: {x}</Chip>)}
                <Chip>Unchanged: {change.unchanged.join(", ")}</Chip>
                {change.designDoc && <Chip tone="violet">Design: {change.designDoc}</Chip>}
              </div>
              <EngineerOnly>
                <div className="rounded-xl border border-dashed border-line-2 bg-panel-2 px-3 py-2.5 font-mono text-xs text-fog">
                  <b className="font-medium text-cyan">{change.engineer.pr}</b> {change.engineer.branch} · {change.engineer.stats}
                  {change.engineer.files.map((f) => <div key={f}>{f}</div>)}
                  <div>Preview: {change.engineer.preview}</div>
                </div>
              </EngineerOnly>
            </CardBody>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHead title="Why it's safe" hint="Checked by a second AI" />
              <CardBody>
                <ul className="flex flex-col gap-2">
                  {change.evidence.map((e) => (
                    <li key={e.label} className="flex gap-2.5 text-[13px]">
                      <span className={cx("w-3.5 shrink-0 font-bold", e.status === "pass" ? "text-good" : "text-warn")}>{e.status === "pass" ? "✓" : "!"}</span>
                      {e.label}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                  <Eyebrow>Gates</Eyebrow>
                  {gates.length === 0 ? <Chip tone="good">Ships on evidence</Chip> : gates.map((g) => <Chip key={g}>{GATE_LABEL[g]}</Chip>)}
                </div>
                <EngineerOnly>
                  <div className="mt-3 rounded-xl border border-dashed border-line-2 bg-panel-2 px-3 py-2 font-mono text-xs text-fog">{change.engineer.models}</div>
                </EngineerOnly>
              </CardBody>
            </Card>
            <TryPanel siteId={site} change={change} canApprove={canApprove(role, change.risk)} />
          </div>
        </div>
      </Page>
    </>
  );
}
