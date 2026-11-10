import Link from "next/link";
import type { SpendScorecard } from "@accelerator/domain";

import { AREA_COLOR, SpendChart } from "@/components/spend-chart";
import { button, Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { serverApi } from "@/lib/api";
import { load } from "@/lib/load";

export const metadata = { title: "Spend" };

const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0");
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/** The site's spend scorecard: what its AI work cost, and which work cost it. */
export default async function SpendPage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ days?: string }> }) {
  const [{ site }, sp] = await Promise.all([params, searchParams]);
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const api = await serverApi();
  const { data, note } = await load(() => api.cradle.spend(site, days));
  return (
    <>
      <PageHeader title="Spend" sub="What this site's AI work costs, and which work costs it: the crew reading and changing the code, the running app serving shoppers, and the gate proving the rules." />
      <Page>
        <div className="flex flex-wrap gap-2">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`/s/${site}/spend?days=${d}`} className={button(d === days ? "gold" : "ghost")}>Last {d} days</Link>
          ))}
        </div>
        {data ? <Spend s={data} /> : <Card><CardBody className="pt-5 text-[13.5px] text-fog">{note ?? "Not available."}</CardBody></Card>}
      </Page>
    </>
  );
}

function Spend({ s }: { s: SpendScorecard }) {
  const top = s.lines[0]?.costUsd || 1;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Last ${s.days} days`} value={usd(s.totalUsd)} note={`since ${s.since.slice(0, 10)}`} />
        <Stat label="Last 7 days" value={usd(s.last7Usd)} note="all areas" />
        <Stat label="Today" value={usd(s.todayUsd)} note="UTC day" />
        <Stat label="Biggest cost" value={s.lines[0]?.label ?? "—"} note={s.lines[0] ? `${usd(s.lines[0].costUsd)} · ${s.totalUsd ? Math.round((s.lines[0].costUsd / s.totalUsd) * 100) : 0}% of spend` : "nothing spent"} small />
      </div>

      {s.notes.length > 0 && (
        <div className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[13px] text-fog">
          {s.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}

      <Card>
        <CardHead title="Spend per day" hint="Stacked by area. Hover a day for its breakdown." />
        <CardBody><SpendChart daily={s.daily} /></CardBody>
      </Card>

      <Card>
        <CardHead title="Which work costs the money" hint="Most expensive first, with the cost of one unit: one ingest, one search, one proof run." />
        <CardBody>
          <ul className="flex flex-col gap-2.5">
            {s.lines.map((l) => (
              <li key={l.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px] md:grid-cols-[220px_minmax(0,1fr)_auto]">
                <span className="flex items-center gap-2 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: AREA_COLOR[l.area] }} />{l.label}</span>
                <span className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-line md:order-none md:col-span-1">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(1, (l.costUsd / top) * 100)}%`, background: AREA_COLOR[l.area] }} />
                </span>
                <span className="text-right tabular-nums">
                  <span className="text-ink">{usd(l.costUsd)}</span>
                  <span className="text-mist"> · {l.count} × {usd(l.perUnitUsd)} avg</span>
                  {l.count > 1 && <span className={l.latestUsd < l.perUnitUsd * 0.8 ? "text-good" : l.latestUsd > l.perUnitUsd * 1.25 ? "text-warn" : "text-mist"}> · latest {usd(l.latestUsd)}</span>}
                </span>
              </li>
            ))}
            {!s.lines.length && <li className="text-[13px] text-mist">Nothing spent in this period.</li>}
          </ul>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="By area" />
          <CardBody>
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-line">
                {s.byArea.map((a) => (
                  <tr key={a.area}>
                    <td className="py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: AREA_COLOR[a.area] }} />{a.label}</td>
                    <td className="text-right tabular-nums">{usd(a.costUsd)}</td>
                    <td className="w-14 text-right tabular-nums text-mist">{a.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHead title="By model" hint="Crew and app calls; a crew job is split by the models it used (older jobs, run before the per-model meter, count whole under their own model). Proof runs mix models and are counted under Proofs." />
          <CardBody>
            <table className="w-full text-left text-[13px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-widest text-mist"><tr><th className="py-1">Model</th><th className="text-right">Tokens in / out</th><th className="text-right">Cost</th></tr></thead>
              <tbody className="divide-y divide-line">
                {s.byModel.map((m) => (
                  <tr key={m.model}>
                    <td className="py-1.5 font-mono text-[12px]">{m.model}</td>
                    <td className="text-right tabular-nums text-fog">{m.tokensIn || m.tokensOut ? `${tokens(m.tokensIn)} / ${tokens(m.tokensOut)}` : "—"}</td>
                    <td className="text-right tabular-nums">{usd(m.costUsd)}</td>
                  </tr>
                ))}
                {!s.byModel.length && <tr><td colSpan={3} className="py-2 text-mist">No model calls in this period.</td></tr>}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHead title="The most expensive jobs" hint="Single crew runs, biggest first." />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-widest text-mist"><tr><th className="py-1">When</th><th>Job</th><th>Work item</th><th>Model</th><th className="text-right">Cost</th></tr></thead>
              <tbody className="divide-y divide-line">
                {s.topJobs.map((j) => (
                  <tr key={j.id}>
                    <td className="py-1.5 pr-3 text-fog">{new Date(j.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="pr-3">{j.label}{j.status === "failed" ? <span className="text-bad"> · failed</span> : null}</td>
                    <td className="max-w-[240px] truncate pr-3 text-fog">{j.workNumber != null ? `#${j.workNumber} ${j.title ?? ""}` : "—"}</td>
                    <td className="pr-3 font-mono text-[12px]">{j.meter?.length ? j.meter.map((m) => `${m.model.replace(/^claude-/, "")} ${usd(m.costUsd)}`).join(" + ") : j.model}</td>
                    <td className="text-right tabular-nums">{usd(j.costUsd ?? 0)}</td>
                  </tr>
                ))}
                {!s.topJobs.length && <tr><td colSpan={5} className="py-2 text-mist">No metered crew jobs in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <details className="text-[13px]">
        <summary className="cursor-pointer text-fog">Daily figures as a table</summary>
        <table className="mt-2 w-full max-w-[520px] text-left">
          <thead className="font-mono text-[10.5px] uppercase tracking-widest text-mist"><tr><th className="py-1">Day</th><th className="text-right">Crew</th><th className="text-right">App</th><th className="text-right">Proofs</th></tr></thead>
          <tbody className="divide-y divide-line tabular-nums">
            {s.daily.map((d) => <tr key={d.day}><td className="py-1">{d.day}</td><td className="text-right">{usd(d.crew)}</td><td className="text-right">{usd(d.app)}</td><td className="text-right">{usd(d.proofs)}</td></tr>)}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Stat({ label, value, note, small }: { label: string; value: string; note: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</div>
      <div className={`truncate ${small ? "text-[14px] leading-[27px]" : "font-mono text-[18px]"} text-ink`}>{value}</div>
      <div className="text-[12px] text-mist">{note}</div>
    </div>
  );
}
