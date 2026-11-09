"use client";

import { useState } from "react";
import type { SpendArea, SpendScorecard } from "@accelerator/domain";

/**
 * Daily spend, stacked by area. Colors: the validated categorical slots 1-3
 * for a dark surface (dataviz palette; checked against #121216). Identity is
 * never color alone: a legend sits above, and the hover card names each part.
 */
export const AREA_COLOR: Record<SpendArea, string> = { crew: "#3987e5", app: "#d95926", proofs: "#199e70" };
const ORDER: SpendArea[] = ["crew", "app", "proofs"];
const LABEL: Record<SpendArea, string> = { crew: "Crew", app: "App", proofs: "Proofs" };
const usd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0");

export function SpendChart({ daily }: { daily: SpendScorecard["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = daily.map((d) => d.crew + d.app + d.proofs);
  const max = Math.max(...totals, 0.0001);
  const W = 720, H = 180, gap = 2;
  const bw = W / daily.length;
  const h = hover == null ? null : daily[hover]!;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 text-[12px] text-fog">
        {ORDER.map((a) => (
          <span key={a} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: AREA_COLOR[a] }} />{LABEL[a]}</span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-mist">peak {usd(max)} a day</span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[180px] w-full" preserveAspectRatio="none" role="img" aria-label="Spend per day, stacked by crew, app and proofs" onMouseLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-line-2)" strokeWidth={1} />
          {daily.map((d, i) => {
            let y = H;
            const x = i * bw + 1;
            const w = Math.max(1, bw - 2);
            const parts = ORDER.filter((a) => d[a] > 0);
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)}>
                <rect x={i * bw} y={0} width={bw} height={H} fill={hover === i ? "rgba(255,255,255,0.04)" : "transparent"} />
                {parts.map((a, k) => {
                  const ph = (d[a] / max) * (H - 6);
                  y -= ph;
                  const top = k === parts.length - 1;
                  const rect = <rect key={a} x={x} y={y} width={w} height={Math.max(0, ph - (top ? 0 : gap))} rx={top ? Math.min(4, w / 2) : 0} fill={AREA_COLOR[a]} />;
                  return rect;
                })}
              </g>
            );
          })}
        </svg>
        {h && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-line-2 bg-panel-2 px-2.5 py-1.5 text-[12px] shadow-lg" style={{ left: `min(calc(${((hover! + 0.5) / daily.length) * 100}% + 8px), calc(100% - 170px))` }}>
            <div className="font-mono text-[11px] text-mist">{h.day}</div>
            {ORDER.map((a) => (
              <div key={a} className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: AREA_COLOR[a] }} /><span className="text-fog">{LABEL[a]}</span><span className="ml-auto pl-4 tabular-nums text-ink">{usd(h[a])}</span></div>
            ))}
            <div className="mt-0.5 border-t border-line pt-0.5 text-right tabular-nums text-ink">{usd(h.crew + h.app + h.proofs)}</div>
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-mist"><span>{daily[0]?.day}</span><span>{daily.at(-1)?.day}</span></div>
    </div>
  );
}
