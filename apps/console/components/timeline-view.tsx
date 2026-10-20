"use client";

import Link from "next/link";
import { useState } from "react";
import { TIMELINE_FILTERS, timelineCategory, timelineDays, type TimelineFilter, type TimelineResponse } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";
import { button, Card, CardBody, Chip, cx, type Tone } from "./ui";

/**
 * The Site Timeline (gen2-crew.md §18, G2.5): the Change Ledger, everything
 * that happened on the site in order, by day. Filters narrow it; "Load
 * earlier" pages back. Each entry names who acted and links its Work item.
 */

const FILTER_LABEL: Record<TimelineFilter, string> = { all: "Everything", decisions: "Decisions", evidence: "Evidence", crew: "Crew", people: "People", system: "System" };
const TONE: Record<ReturnType<typeof timelineCategory>, Tone> = { decisions: "gold", evidence: "good", crew: "violet", people: "cyan", system: "default" };

export function TimelineView({ siteId, initial, work }: { siteId: string; initial: TimelineResponse; work?: number }) {
  const [entries, setEntries] = useState(initial.entries);
  const [next, setNext] = useState(initial.next);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [busy, setBusy] = useState(false);
  const api = browserApi();

  async function more() {
    setBusy(true);
    try {
      const page = await api.timeline(siteId, { before: next, work });
      setEntries((e) => [...e, ...page.entries]);
      setNext(page.next);
    } finally {
      setBusy(false);
    }
  }

  const days = timelineDays(entries, filter);
  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
        {TIMELINE_FILTERS.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={button(filter === f ? "plain" : "ghost", cx("py-1", filter === f && "border-violet text-ink"))}>
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {days.length === 0 && (
        <Card>
          <CardBody className="pt-5 text-[13.5px] text-mist">Nothing on the timeline{filter !== "all" ? ` under ${FILTER_LABEL[filter].toLowerCase()}` : ""} yet.</CardBody>
        </Card>
      )}
      {days.map((d) => (
        <Card key={d.day}>
          <div className="px-5 pt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-mist">{d.day}</div>
          <CardBody>
            <ol className="flex flex-col gap-2.5" data-timeline-day={d.day}>
              {d.entries.map((e) => {
                const cat = timelineCategory(e);
                return (
                  <li key={e.id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 text-[13px]" data-entry={e.kind}>
                    <time className="pt-0.5 font-mono text-[11.5px] text-mist" dateTime={e.at}>{e.at.slice(11, 16)}</time>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip tone={TONE[cat]}>{e.actor}</Chip>
                        <span className="text-[11px] text-mist">{e.kind.replace(/_/g, " ")}</span>
                        {e.counts && <span className="text-[11px] text-good" title="An evidence-backed contribution">● counts</span>}
                        {e.work && (
                          <Link href={`/s/${siteId}/work/${e.work.number}`} className="text-[11.5px] text-fog underline-offset-2 hover:text-ink hover:underline">
                            #{e.work.number} {e.work.title}
                          </Link>
                        )}
                      </div>
                      <p className="mt-0.5 text-fog">{e.summary}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      ))}
      {next && (
        <button type="button" className={button("plain", "self-start")} onClick={more} disabled={busy}>
          {busy ? "Loading…" : "Load earlier"}
        </button>
      )}
    </>
  );
}
