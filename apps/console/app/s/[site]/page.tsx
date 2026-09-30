import Link from "next/link";
import { HUMAN_STAGES, LOOP, STAGE_LABEL } from "@accelerator/domain";

import { siteAccess } from "@/lib/access";
import { getBridge } from "@/lib/api";
import { ToastButton } from "@/components/ui-provider";
import { Bar, button, Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader, Sparkline } from "@/components/ui";

export const metadata = { title: "Bridge" };

const KIND = {
  try: { label: "Try", cls: "bg-cyan/12 text-cyan" },
  decide: { label: "Decide", cls: "bg-violet/15 text-violet" },
  approve: { label: "Approve", cls: "bg-warn/12 text-warn" },
  ship: { label: "Go live", cls: "bg-good/12 text-good" },
} as const;

const SEV = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", info: "bg-cyan" } as const;

export default async function BridgePage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const [b, { me, can }] = await Promise.all([getBridge(slug), siteAccess(slug)]);
  const g = b.gauges;
  const base = `/s/${slug}`;

  return (
    <>
      <PageHeader title="Bridge" sub="Is the site OK, what's moving, and what needs you.">
        {me.mode === "demo" && <Chip tone="warn" className="font-mono uppercase tracking-wider">Demo tenant</Chip>}
        {can("request.create") && (
          <Link href={`${base}/requests`} className={button("gold")}>
            + New request
          </Link>
        )}
      </PageHeader>
      <Page>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5">
          <Card className="flex flex-col gap-2 p-4">
            <Eyebrow>Site health</Eyebrow>
            <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">
              {g.health}
              <small className="text-sm font-medium text-mist">/100</small>
            </div>
            <Bar value={g.health} />
            <p className="text-[12.5px] leading-snug text-fog">{g.healthNote}</p>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <Eyebrow>Time to live</Eyebrow>
            <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">
              {g.timeToLiveDays}
              <small className="text-sm font-medium text-mist"> days</small>
            </div>
            <Sparkline values={[6.5, 5.8, 5.1, 4.2, 3.9, 3.1, 2.8, 2.2, 2.0, 1.7, 1.5, 1.4]} />
            <p className="text-[12.5px] leading-snug text-fog">{g.timeToLiveNote}</p>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <Eyebrow>Open requests</Eyebrow>
            <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{g.openRequests}</div>
            <p className="text-[12.5px] leading-snug text-fog">{g.openNote}</p>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <Eyebrow>Quality</Eyebrow>
            <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">
              {g.quality}
              <small className="text-sm font-medium text-mist">%</small>
            </div>
            <Bar value={g.quality} />
            <p className="text-[12.5px] leading-snug text-fog">{g.qualityNote}</p>
          </Card>
          <Card className="flex flex-col gap-2 p-4">
            <Eyebrow>Spend</Eyebrow>
            <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">
              ${g.spendUsd}
              <small className="text-sm font-medium text-mist"> / ${g.budgetUsd}</small>
            </div>
            <Bar value={(g.spendUsd / g.budgetUsd) * 100} />
            <p className="text-[12.5px] leading-snug text-fog">{g.spendNote}</p>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <Card>
            <CardHead title="Needs you" hint="Sorted by what unblocks the most work" />
            <CardBody className="flex flex-col">
              {b.needsYou.map((n, i) => (
                <div key={n.id} className={cx("grid items-center gap-3 py-3 sm:grid-cols-[auto_1fr_auto]", i > 0 && "border-t border-line")}>
                  <span className={cx("w-fit rounded-md px-2 py-1 text-center font-mono text-[10.5px] uppercase tracking-wider sm:w-16", KIND[n.kind].cls)}>{KIND[n.kind].label}</span>
                  <div>
                    <h3 className="text-[13.5px] font-semibold">{n.title}</h3>
                    <p className="text-[12.5px] text-fog">{n.detail}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:justify-end">
                    {n.href && (
                      <Link href={`${base}/${n.href}`} className={button(n.kind === "try" ? "gold" : "plain", "text-xs")}>
                        {n.kind === "try" ? "Open Change Room" : "Review"}
                      </Link>
                    )}
                    {n.options?.map((o) => (
                      <ToastButton key={o} className={button("plain", "text-xs")} message={`Saved: ${o}. Every page will be updated in one change.`}>
                        {o}
                      </ToastButton>
                    ))}
                    {n.kind === "ship" && can("release.ship") && (
                      <ToastButton className={button("plain", "text-xs")} message="Going live. You'll get a note when it's verified on the live site.">
                        Go live
                      </ToastButton>
                    )}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHead title="Signals" hint="What the engine noticed on its own" />
            <CardBody className="flex flex-col gap-3">
              {b.signals.map((s) => (
                <div key={s.id} className="flex gap-2.5 text-[13px]">
                  <span className={cx("w-1 shrink-0 self-stretch rounded", SEV[s.severity])} />
                  <div>
                    <p>{s.title}</p>
                    <p className="text-xs text-mist">{s.detail}</p>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHead title="In flight" hint="Every change, moving along the loop" />
          <CardBody className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            {LOOP.filter((s) => s !== "done").map((stage) => {
              const items = b.inFlight.filter((r) => r.stage === stage);
              const yours = HUMAN_STAGES.includes(stage);
              return (
                <div key={stage} className="flex min-w-0 flex-col gap-2">
                  <h4 className={cx("flex justify-between font-mono text-[11px] uppercase tracking-[0.12em]", yours ? "text-gold-2" : "text-mist")}>
                    {STAGE_LABEL[stage]} <span>{items.length}</span>
                  </h4>
                  {items.map((r) => (
                    <div key={r.id} className={cx("flex flex-col gap-1 rounded-xl border bg-panel-2 px-2.5 py-2 text-[12.5px]", yours ? "border-gold/55" : "border-line")}>
                      <span className="font-mono text-[11px] text-mist">#{r.number}</span>
                      <b className="font-medium leading-snug">{r.title}</b>
                      {r.note && <Chip tone="warn" className="self-start">{r.note}</Chip>}
                      {r.risk.includes("money") && !r.note && <Chip tone="violet" className="self-start">Money · gated</Chip>}
                    </div>
                  ))}
                </div>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Recently live" hint="With undo" />
          <CardBody className="grid gap-3 md:grid-cols-3">
            {b.recentReleases.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3">
                <h3 className="text-[13px] font-semibold">{r.title}</h3>
                <p className="text-xs text-fog">{r.detail}</p>
                <div className="mt-auto flex items-center justify-between text-xs text-mist">
                  <span>{r.at}</span>
                  <ToastButton className={button("ghost", "text-xs")} message="Undo restores the previous release in about 30 seconds.">
                    Undo
                  </ToastButton>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
