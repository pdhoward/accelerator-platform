import { Card, CardBody, CardHead, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Metrics" };

// v0: illustrative series for the demo tenant; the API will compute these from acc_requests/acc_releases.
const WEEKS = [6.5, 5.8, 5.1, 4.2, 3.9, 3.1, 2.8, 2.2, 2.0, 1.7, 1.5, 1.4];
const BASELINE = 11;

const STATS = [
  { label: "Backlog half-life", value: "9 days", note: "Down from 31 at onboarding." },
  { label: "First-pass approval", value: "92%", note: "Changes approved without a send-back." },
  { label: "Your time per change", value: "14 min", note: "Clarify + try + ship, median." },
  { label: "Shipped on evidence", value: "38%", note: "Low-risk changes live without a manual try." },
  { label: "Escaped defects", value: "1", note: "This quarter. Caught by a data check in 6 h." },
  { label: "Cost per change", value: "$6.10", note: "AI + hosting. Agency average: $1,140." },
];

function TimeToLiveChart() {
  const W = 640, H = 260, L = 40, R = 16, T = 16, B = 34, max = 12;
  const step = (W - L - R) / WEEKS.length;
  const x = (i: number) => L + (i + 0.5) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const bw = step * 0.56;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Median time to live fell from 6.5 days to 1.4 days over 12 weeks, against an agency baseline of 11 days">
      {[0, 3, 6, 9, 12].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-line)" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--color-mist)" fontFamily="var(--font-mono)">{v}</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={y(BASELINE)} y2={y(BASELINE)} stroke="var(--color-warn)" strokeWidth="1.5" strokeDasharray="5 4" />
      <text x={W - R} y={y(BASELINE) - 6} textAnchor="end" fontSize="11" fill="var(--color-warn)">Agency baseline: 11 days</text>
      {WEEKS.map((v, i) => {
        const last = i === WEEKS.length - 1;
        return (
          <g key={i}>
            <rect x={x(i) - bw / 2} y={y(v)} width={bw} height={y(0) - y(v)} rx="3" fill={last ? "var(--color-cyan)" : "var(--color-violet)"} opacity={last ? 1 : 0.55} />
            {(i % 2 === 0 || last) && (
              <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="var(--color-mist)" fontFamily="var(--font-mono)">W{i + 1}</text>
            )}
          </g>
        );
      })}
      <text x={x(WEEKS.length - 1)} y={y(1.4) - 7} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-ink)">1.4</text>
    </svg>
  );
}

export default function MetricsPage() {
  return (
    <>
      <PageHeader title="Metrics" sub="How fast and how well changes reach your customers." />
      <Page>
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHead title="Time to live" hint="Median days from request to live, by week" />
            <CardBody>
              <TimeToLiveChart />
            </CardBody>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl border border-line bg-panel-2 p-3.5">
                <Eyebrow>{s.label}</Eyebrow>
                <div className="text-xl font-semibold tracking-tight tabular-nums">{s.value}</div>
                <p className="text-xs text-fog">{s.note}</p>
              </div>
            ))}
          </div>
        </div>
      </Page>
    </>
  );
}
