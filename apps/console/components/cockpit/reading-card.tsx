"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ago, type Reading, type Ring } from "@accelerator/domain";

import { Chip, cx, type Tone } from "../ui";
import { CONDITION_WORD } from "./cockpit-dial";
import { arcPath } from "./geometry";

/**
 * The card a turned dial brings forward (gen2-crew.md §19.5): the facts that
 * matter, a trend, the source and its freshness, and the way to the evidence.
 * Crew readings add activity rings and a 28-day contribution row.
 */

const TONE: Record<Reading["condition"], Tone> = { verified: "good", attention: "warn", unverified: "default", not_connected: "default" };

export function ReadingCard({ r, siteId, observedAt }: { r: Reading; siteId: string; observedAt: string }) {
  const base = `/s/${encodeURIComponent(siteId)}`;
  const href = r.evidence ? (r.evidence.href === "workItem" && r.evidence.number ? `${base}/work/${r.evidence.number}` : `${base}/work`) : null;
  return (
    <article
      key={r.id}
      aria-labelledby={`reading-${r.id}`}
      className="flex h-full flex-col gap-4 rounded-2xl border border-line bg-panel-2/40 p-5 motion-safe:animate-[card-rise_380ms_cubic-bezier(0.2,0.9,0.3,1)]"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`reading-${r.id}`} className="text-base font-semibold tracking-tight">
          {r.label}
        </h3>
        <Chip tone={TONE[r.condition]}>{CONDITION_WORD[r.condition]}</Chip>
        {r.stale && <Chip tone="warn">Stale</Chip>}
        {r.change && <span className="ml-auto text-[12px] tabular-nums text-fog">{r.change}</span>}
      </header>

      <div className={cx("grid gap-5", r.rings ? "sm:grid-cols-[auto_1fr] sm:items-center" : "")}>
        {r.rings && <ActivityRings rings={r.rings} />}
        <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-fog">
          {r.facts.map((f) => (
            <li key={f} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-mist" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      {r.days ? <ContributionRow days={r.days} label={r.label} /> : r.trend.length > 1 && <Sparkline values={r.trend} />}

      <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] text-mist">
        <span>{r.source ? `Source: ${r.source}` : "No source recorded"}</span>
        {r.observedAt && <span>· {ago(r.observedAt, observedAt)}</span>}
        {href && r.evidence && (
          <Link href={href} className="ml-auto inline-flex items-center gap-1 font-medium text-cyan hover:underline">
            {r.evidence.label} <ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </footer>
    </article>
  );
}

const RING_COLORS = ["var(--color-violet)", "var(--color-cyan)", "var(--color-gold-2)"];

/** Concentric activity rings: each sweeps to value/goal; past 100% a second lap runs inside the ring. */
export function ActivityRings({ rings }: { rings: Ring[] }) {
  const S = 132;
  const c = S / 2;
  const width = 11;
  const summary = rings.map((g) => `${g.label}: ${g.display}`).join("; ");
  return (
    <figure className="flex items-center gap-4">
      <svg viewBox={`0 0 ${S} ${S}`} className="size-[132px] shrink-0" role="img" aria-label={summary}>
        {rings.map((g, k) => {
          const r = c - width / 2 - 2 - k * (width + 4);
          const frac = g.goal > 0 ? g.value / g.goal : 0;
          const lap = Math.min(frac, 1);
          const extra = Math.min(Math.max(frac - 1, 0), 1);
          const len = 2 * Math.PI * r;
          return (
            <g key={g.label}>
              <circle cx={c} cy={c} r={r} fill="none" stroke="var(--color-panel-2)" strokeWidth={width} />
              <circle
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={RING_COLORS[k % RING_COLORS.length]}
                strokeWidth={width}
                strokeLinecap="round"
                strokeDasharray={`${len} ${len}`}
                strokeDashoffset={len * (1 - lap)}
                transform={`rotate(-90 ${c} ${c})`}
                className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700 motion-safe:ease-out"
                opacity={g.value === 0 ? 0 : 1}
              />
              {extra > 0 && (
                <path
                  d={arcPath(c, r - width / 2 + 2, 0, Math.max(1, extra * 359.9))}
                  fill="none"
                  stroke={RING_COLORS[k % RING_COLORS.length]}
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-col gap-2 text-[12px]">
        {rings.map((g, k) => (
          <span key={g.label} className="flex items-center gap-2">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: RING_COLORS[k % RING_COLORS.length] }} />
            <span className="text-fog">{g.label}</span>
            <span className="font-semibold tabular-nums text-ink">{g.display}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Four weeks of evidence-backed contributions, one square a day (GitHub style: a column per week). */
export function ContributionRow({ days, label }: { days: number[]; label: string }) {
  const max = Math.max(...days, 1);
  const total = days.reduce((a, b) => a + b, 0);
  const level = (v: number) => (v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const shade = ["var(--color-panel-2)", "color-mix(in oklab, var(--color-violet) 32%, transparent)", "color-mix(in oklab, var(--color-violet) 55%, transparent)", "color-mix(in oklab, var(--color-violet) 78%, transparent)", "var(--color-violet)"];
  const weeks = [0, 1, 2, 3].map((w) => days.slice(w * 7, w * 7 + 7));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div role="img" aria-label={`${label}: ${total} evidence-backed contributions in 28 days`} className="flex gap-[3px]">
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {week.map((v, d) => (
              <span key={d} title={`${v} on day ${w * 7 + d + 1} of 28`} className="block size-[11px] rounded-[3px]" style={{ background: shade[level(v)] }} />
            ))}
          </div>
        ))}
      </div>
      <p className="text-[12px] text-mist">
        <span className="font-semibold tabular-nums text-fog">{total}</span> evidence-backed in 28 days · messages and tokens don&apos;t count
      </p>
    </div>
  );
}

/** A quiet trend line; the facts above carry the numbers. */
export function Sparkline({ values }: { values: number[] }) {
  const W = 220;
  const H = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (W - 6) + 3, H - 4 - ((v - min) / span) * (H - 8)] as const);
  const last = pts.at(-1)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full max-w-[260px]" aria-hidden preserveAspectRatio="none">
      <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="var(--color-cyan)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2.6} fill="var(--color-cyan)" />
    </svg>
  );
}
