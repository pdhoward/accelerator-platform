"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gauge, List, Users } from "lucide-react";
import { ago, type Face, type InstrumentsResponse } from "@accelerator/domain";

import { timestamp } from "@/lib/format";
import { browserApi } from "@/lib/browser-api";

import { button, Card, cx, Eyebrow } from "../ui";
import { CockpitDial, CONDITION_WORD } from "./cockpit-dial";
import { ReadingCard } from "./reading-card";

/**
 * The Cockpit (gen2-crew.md §19.5): one dial with a Site face and a Crew face,
 * resting on what needs attention first, and the card for the selected
 * measure. Refreshes from records; never invents a reading.
 */
export function CockpitPanel({ siteId, initial, number, compact = false }: { siteId: string; initial: InstrumentsResponse; number?: number; compact?: boolean }) {
  const [data, setData] = useState(initial);
  const [face, setFace] = useState<Face>(initial.rest.face);
  const [picked, setPicked] = useState<Record<Face, number>>(() => ({
    site: Math.max(0, initial.site.findIndex((r) => r.id === initial.rest.id)),
    crew: Math.max(0, initial.crew.findIndex((r) => r.id === initial.rest.id)),
  }));
  const [list, setList] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [stale, setStale] = useState(false);

  const readings = face === "site" ? data.site : data.crew;
  const index = Math.min(picked[face], readings.length - 1);
  const current = readings[index]!;

  const choose = useCallback(
    (i: number) => {
      setPicked((p) => ({ ...p, [face]: i }));
      const r = readings[i]!;
      setAnnounce(`${r.label}: ${r.headline ? `${r.headline} ${r.unit}` : r.state}. ${CONDITION_WORD[r.condition]}.`);
    },
    [face, readings],
  );

  // Fresh readings every 15 s while the tab is visible; the sample is static.
  useEffect(() => {
    if (initial.source === "sample") return;
    let alive = true;
    const t = setInterval(() => {
      if (document.hidden) return;
      void browserApi()
        .instruments(siteId, number)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setStale(false);
        })
        .catch(() => alive && setStale(true));
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [siteId, number, initial.source]);

  const counts = useMemo(() => {
    const all = [...data.site, ...data.crew];
    return {
      attention: all.filter((r) => r.condition === "attention").length,
      verified: all.filter((r) => r.condition === "verified").length,
      missing: all.filter((r) => r.condition === "not_connected").length,
    };
  }, [data]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <Eyebrow>{number ? `Cockpit · #${number}` : "Cockpit"}</Eyebrow>
          <p className="mt-1 text-[13px] text-fog">
            {counts.attention ? (
              <span className="font-medium text-warn">{counts.attention} need a look</span>
            ) : (
              <span className="font-medium text-good">Nothing needs a look</span>
            )}{" "}
            · {counts.verified} verified · {counts.missing} not connected
          </p>
        </div>
        <div className={cx("flex flex-wrap items-center gap-2", !compact && "ml-auto")}>
          <div role="radiogroup" aria-label="Dial face" className="flex rounded-lg border border-line-2 bg-panel p-0.5 text-[12.5px]">
            {(
              [
                ["site", "Site", Gauge],
                ["crew", "Crew", Users],
              ] as const
            ).map(([f, labelText, Icon]) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={face === f}
                onClick={() => setFace(f)}
                className={cx("inline-flex items-center gap-1.5 rounded-md px-3 py-1", face === f ? "bg-gold/15 font-semibold text-ink" : "text-fog hover:text-ink")}
              >
                <Icon className="size-3.5" /> {labelText}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={list} onClick={() => setList((l) => !l)} className={button(list ? "plain" : "ghost", "text-xs")}>
            <List className="size-3.5" /> {list ? "Show the dial" : "Show as list"}
          </button>
        </div>
      </div>

      {data.source === "sample" && (
        <p role="status" className="border-b border-warn/30 bg-warn/5 px-5 py-2 text-[12.5px] text-warn">
          Illustrative readings · synthetic records, not a live site.
        </p>
      )}

      {list ? (
        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <caption className="sr-only">{face === "site" ? "Site" : "Crew"} readings</caption>
            <thead className="text-[11px] uppercase tracking-wider text-mist">
              <tr>
                <th className="py-2 pr-3 font-medium">Measure</th>
                <th className="py-2 pr-3 font-medium">Condition</th>
                <th className="py-2 pr-3 font-medium">Reading</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 font-medium">Observed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {readings.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 pr-3 font-medium">{r.label}</td>
                  <td className="py-2.5 pr-3 text-fog">
                    {CONDITION_WORD[r.condition]}
                    {r.stale ? " (stale)" : ""}
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums">{r.headline ? `${r.headline} ${r.unit}` : r.state}</td>
                  <td className="py-2.5 pr-3 text-fog">{r.source ?? "—"}</td>
                  <td className="py-2.5 text-fog">{r.observedAt ? ago(r.observedAt, data.observedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={cx("grid items-center gap-6 px-5 py-6", !compact && "lg:grid-cols-[minmax(260px,340px)_1fr]")}>
          <div className={cx("flex flex-col items-center gap-3", compact && "mx-auto w-full max-w-[280px]")}>
            <CockpitDial key={face} readings={readings} index={index} onIndex={choose} label={`${face === "site" ? "Site" : "Crew"} measures`} />
            <p className="text-center text-[11.5px] text-mist">Turn the dial: drag, arrow keys or scroll · tap a segment to jump</p>
          </div>
          <ReadingCard r={current} siteId={siteId} observedAt={data.observedAt} />
        </div>
      )}

      <p className="border-t border-line px-5 py-2.5 text-[11.5px] text-mist">
        Record-derived · last received {timestamp(data.observedAt)}
        {stale ? " · refresh failed; showing the last readings" : ""} · numbers and conditions come from records, never from a model
      </p>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </Card>
  );
}
