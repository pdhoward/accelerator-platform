import { serverApi } from "@/lib/api";
import { ToastButton } from "@/components/ui-provider";
import { Bar, button, Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Proof" };

export default async function ProofPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const proof = await serverApi().proof(site);
  const total = proof.suites.reduce((s, x) => s + x.tests, 0);
  const passed = proof.suites.reduce((s, x) => s + x.passed, 0);
  const ready = proof.verdict === "ready";

  return (
    <>
      <PageHeader title="Proof" sub="Every change is tested the same way, every time: resolve, add tests, retest, confirm, deploy.">
        <ToastButton className={button("gold")} message="Running every layer against the current staging build. Results appear here as each layer finishes.">
          Run everything
        </ToastButton>
      </PageHeader>
      <Page>
        <Card className={cx("flex flex-wrap items-center gap-5 p-5", ready ? "border-good/40" : "border-warn/45")}>
          <div className={cx("grid size-16 place-items-center rounded-2xl text-2xl font-bold", ready ? "bg-good/12 text-good" : "bg-warn/12 text-warn")}>{ready ? "✓" : "!"}</div>
          <div className="min-w-0 flex-1">
            <Eyebrow>Readiness verdict</Eyebrow>
            <h2 className="text-xl font-semibold tracking-tight">{ready ? "Ready to ship" : "Needs work"}</h2>
            <p className="text-[13px] text-fog">{proof.verdictNote}</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold tabular-nums">{passed.toLocaleString()} / {total.toLocaleString()}</div>
            <span className="text-xs text-mist">checks passing across {proof.suites.length} layers</span>
          </div>
        </Card>

        <Card>
          <CardHead title="The layers" hint="Held-out suites are written by the judge; the builder can't weaken them" />
          <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {proof.suites.map((s) => {
              const pct = Math.round((s.passed / s.tests) * 100);
              const ok = s.passed === s.tests;
              return (
                <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13.5px] font-semibold">{s.name}</h3>
                    <Chip tone={ok ? "good" : "warn"}>{ok ? "Pass" : `${s.tests - s.passed} failing`}</Chip>
                  </div>
                  <p className="text-xs leading-snug text-fog">{s.description}</p>
                  <Bar value={pct} tone={ok ? "good" : "warn"} />
                  <div className="flex flex-wrap justify-between gap-2 text-[11.5px] text-mist">
                    <span className="tabular-nums">{s.passed}/{s.tests} · {s.durationSec}s · {s.lastRun}</span>
                    {s.heldOut && <span className="text-violet">held out</span>}
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHead title="Synthetic data that mirrors production" hint="Real shapes and volumes, no real people" />
            <CardBody className="flex flex-col gap-3">
              {proof.datasets.map((d) => (
                <div key={d.id} className="grid gap-1 rounded-xl border border-line bg-panel-2 p-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <h3 className="text-[13.5px] font-semibold">{d.name}</h3>
                    <p className="text-xs text-fog">Mirrors: {d.mirrors}</p>
                    <p className="text-xs text-mist">{d.notes}</p>
                  </div>
                  <div className="text-right text-xs text-mist">
                    <div className="font-mono text-base text-ink tabular-nums">{d.rows.toLocaleString()}</div>
                    rows · refreshed {d.refreshed}
                  </div>
                </div>
              ))}
              <p className="text-xs text-mist">
                New changes are tested against this data before anyone tries them, so one-shot deployments are the norm, not luck.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHead title="Recent verdicts" />
            <CardBody className="flex flex-col">
              {proof.recentRuns.map((r, i) => (
                <div key={i} className={cx("flex gap-3 py-2.5 text-[13px]", i > 0 && "border-t border-line")}>
                  <span className={cx("w-1 shrink-0 rounded", r.result === "ready" ? "bg-good" : "bg-warn")} />
                  <div className="min-w-0">
                    <p className="font-medium">{r.change}</p>
                    <p className="text-xs text-fog">{r.detail}</p>
                    <p className="text-[11px] text-mist">{r.at}</p>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </Page>
    </>
  );
}
