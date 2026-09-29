import type { Triage } from "@accelerator/domain";

import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { LighthouseRunner } from "@/components/lighthouse-runner";
import { EngineerOnly } from "@/components/ui-provider";
import { Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader, ScoreRing, Sparkline } from "@/components/ui";

export const metadata = { title: "Health" };

const TRIAGE: { id: Triage; label: string; body: string }[] = [
  { id: "critical", label: "Critical", body: "Fragile and risky to touch. Changes break things." },
  { id: "stabilizing", label: "Stabilizing", body: "Safety nets going in: backups, alerts, tests on money paths." },
  { id: "recovering", label: "Recovering", body: "Repairing one area at a time, each step shipped and tested." },
  { id: "healthy", label: "Healthy", body: "Small, tested, reversible changes. Kept current." },
];

export default async function HealthPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [h, { can }] = await Promise.all([(await serverApi()).health.get(site), siteAccess(site)]);
  const at = TRIAGE.findIndex((t) => t.id === h.triage);

  return (
    <>
      <PageHeader title="Health" sub="How the site performs for visitors, and how healthy its code is to keep changing.">
        {can("request.create") && <LighthouseRunner siteId={site} />}
      </PageHeader>
      <Page>
        <Card>
          <CardHead title="Lighthouse" hint="Mobile · performance, accessibility, best practices, SEO" />
          <CardBody className="grid gap-4 md:grid-cols-3">
            {h.lighthouse.map((l) => (
              <div key={l.page} className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px]">{l.page}</span>
                  <Chip tone={l.source === "pagespeed" ? "cyan" : "default"}>{l.source === "pagespeed" ? `Live run · ${new Date(l.ranAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : `Nightly · ${l.ranAt}`}</Chip>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  <ScoreRing score={l.performance} label="Perf." size={58} />
                  <ScoreRing score={l.accessibility} label="Access." size={58} />
                  <ScoreRing score={l.bestPractices} label="Best pr." size={58} />
                  <ScoreRing score={l.seo} label="SEO" size={58} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Architecture triage" hint="For sites that arrive critically ill: stabilize first, then repair" />
          <CardBody className="flex flex-col gap-4">
            <ol className="grid gap-2 md:grid-cols-4" aria-label="Triage stage">
              {TRIAGE.map((t, i) => (
                <li
                  key={t.id}
                  aria-current={i === at ? "step" : undefined}
                  className={cx(
                    "flex flex-col gap-1 rounded-xl border p-3",
                    i === at ? "border-good/50 bg-good/10" : i < at ? "border-line bg-panel-2 opacity-70" : "border-line",
                  )}
                >
                  <span className={cx("font-mono text-[10.5px] uppercase tracking-[0.12em]", i === at ? "text-good" : "text-mist")}>{t.label}</span>
                  <span className="text-xs text-fog">{t.body}</span>
                </li>
              ))}
            </ol>
            <p className="text-[13px]"><b>Today:</b> {h.triageNote}</p>
          </CardBody>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHead title="Vital signs" hint="Trend over the last 7 months" />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              {h.vitals.map((v) => (
                <div key={v.id} className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel-2 p-3.5">
                  <div className="flex items-baseline justify-between">
                    <Eyebrow>{v.name}</Eyebrow>
                    <span className={cx("font-mono text-lg font-semibold tabular-nums", v.score >= 85 ? "text-good" : v.score >= 60 ? "text-warn" : "text-bad")}>{v.score}</span>
                  </div>
                  <p className="text-[13px]">{v.reading}</p>
                  <Sparkline values={v.trend} />
                  <p className="text-[11.5px] text-mist">{v.explains}</p>
                </div>
              ))}
            </CardBody>
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHead title="Treatment plan" />
              <CardBody className="flex flex-col gap-2.5">
                {h.treatmentPlan.map((p) => (
                  <div key={p.phase} className="flex gap-3 text-[13px]">
                    <Chip tone={p.status === "done" ? "good" : p.status === "active" ? "gold" : "default"} className="h-fit w-20 justify-center">{p.phase}</Chip>
                    <span className={p.status === "done" ? "text-fog" : ""}>{p.goal}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHead title="Hotspots" hint="Where changes are riskiest" />
              <CardBody className="flex flex-col gap-3">
                {h.hotspots.map((s) => (
                  <div key={s.path} className="text-[13px]">
                    <p>{s.why}</p>
                    <p className="text-xs text-mist">Changed {s.changes90d} times in 90 days</p>
                    <EngineerOnly>
                      <p className="font-mono text-[11.5px] text-cyan">{s.path}</p>
                    </EngineerOnly>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      </Page>
    </>
  );
}
