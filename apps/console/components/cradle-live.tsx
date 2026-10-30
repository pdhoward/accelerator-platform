"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { browserApi } from "@/lib/browser-api";

/**
 * The live ingest (gen3-cradle.md §3.2, §5): the /vision scene, fed by the
 * crew's real job events. Who is busy comes from each line's speaker
 * ("extractor> …"); the counters come from what the lines report. The phone
 * shows the site itself, live, while the crew reads its code.
 */

type Ev = { id: number; at: string; kind: "status" | "tool" | "log" | "check"; text: string };
type BotId = "lead" | "surveyor" | "extractor" | "clerk" | "gapfinder" | "judge";

const BOTS: { id: BotId; name: string; role: string; color: string; path: string }[] = [
  { id: "lead", name: "Team Lead", role: "runs the walk", color: "#f3f3f6", path: "M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z" },
  { id: "surveyor", name: "Surveyor", role: "maps the code", color: "#2dd4bf", path: "M50 4l11 22 24-6-6 24 17 14-21 11 4 24-23-7-13 21-12-21-24 7 4-24-21-11 17-14-6-24 24 6z" },
  { id: "extractor", name: "Extractor", role: "finds policies", color: "#8b6cff", path: "M30 84c-16 0-24-12-22-24 2-11 11-16 19-15 2-15 15-26 30-24 13 2 22 12 22 24 11 1 17 10 15 20-2 11-11 19-23 19z" },
  { id: "clerk", name: "Clerk", role: "contradictions", color: "#f472b6", path: "M50 90C18 66 6 50 6 33 6 19 17 9 30 9c9 0 16 5 20 12 4-7 11-12 20-12 13 0 24 10 24 24 0 17-12 33-44 57z" },
  { id: "gapfinder", name: "Gap Finder", role: "holes", color: "#f5b843", path: "M50 6c14 20 36 38 36 58a36 36 0 0 1-72 0C14 44 36 26 50 6z" },
  { id: "judge", name: "Judge", role: "checks the book", color: "#f43f5e", path: "M50 6c4 0 7 2 9 6l35 66c4 8-1 16-10 16H16c-9 0-14-8-10-16l35-66c2-4 5-6 9-6z" },
];
const BOT = Object.fromEntries(BOTS.map((b) => [b.id, b])) as Record<BotId, (typeof BOTS)[number]>;

/** "extractor> Read lib/checkout.ts" → extractor. Agent tool lines without a speaker belong to the Extractor. */
function speaker(e: Ev): BotId {
  const m = e.text.match(/^(lead|surveyor|extractor|clerk|gapfinder|judge)>/);
  return m ? (m[1] as BotId) : e.kind === "status" ? "lead" : "extractor";
}
const body = (e: Ev) => e.text.replace(/^(lead|surveyor|extractor|clerk|gapfinder|judge)>\s*/, "");

export function CradleLive({ siteId, jobId, siteUrl, running, onDone }: { siteId: string; jobId: string; siteUrl: string | null; running: boolean; onDone?: () => void }) {
  const api = browserApi();
  const [events, setEvents] = useState<Ev[]>([]);
  const after = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.cradle.events(siteId, jobId, after.current);
        if (r.events.length) {
          after.current = Math.max(after.current, r.events.at(-1)!.id);
          // Two polls can overlap (React runs effects twice in development): keep each event once.
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...r.events.filter((e) => !seen.has(e.id))];
          });
        }
      } catch {
        /* a missed poll is fine; the next one catches up */
      }
      if (!stop && running) timer = setTimeout(tick, 1000);
      else if (!stop) onDone?.();
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, jobId, running]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events.length]);

  const s = useMemo(() => {
    const ops: Record<BotId, number> = { lead: 0, surveyor: 0, extractor: 0, clerk: 0, gapfinder: 0, judge: 0 };
    for (const e of events) ops[speaker(e)]++;
    const last = events.at(-1);
    const files = new Set(events.flatMap((e) => [...body(e).matchAll(/(?:Read\s+)?((?:app|lib|components|pages|src)\/[\w./[\]-]+)/g)].map((m) => m[1]!)));
    return {
      ops,
      busy: running && last ? speaker(last) : null,
      files: files.size,
      found: events.filter((e) => /✓|new:|override/.test(e.text)).length,
      conflicts: events.filter((e) => /CONFLICT/.test(e.text)).length,
      holes: events.filter((e) => /holes?:/.test(e.text)).reduce((n, e) => n + (body(e).split("·").length || 0), 0),
    };
  }, [events, running]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]" data-cradle-live>
      <style>{`
        .cl-bob { animation: cl-bob .9s ease-in-out infinite }
        @keyframes cl-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        .cl-in { animation: cl-in .3s ease-out both }
        @keyframes cl-in { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
        .cl-blink { animation: cl-blink 1s steps(2) infinite } @keyframes cl-blink { 50% { opacity: 0 } }
      `}</style>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Files read" value={s.files} />
          <Stat label="Policies found" value={s.found} tone="violet" />
          <Stat label="Contradictions" value={s.conflicts} tone={s.conflicts ? "bad" : undefined} />
          <Stat label="Holes" value={s.holes} tone={s.holes ? "warn" : undefined} />
        </div>
        <div className="rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2 font-mono text-[12px]">
            <span className="border-b-2 border-gold-2 pb-1 text-ink">crew.log</span>
            {running ? <span className="text-bad"><span className="cl-blink">●</span> LIVE</span> : <span className="text-good">● done</span>}
            <span className="ml-auto text-mist">tail -f · {events.length} lines</span>
          </div>
          <div ref={logRef} className="h-[340px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.75]">
            {events.map((e) => {
              const b = BOT[speaker(e)];
              const conflict = /CONFLICT|FAIL/.test(e.text);
              return (
                <div key={e.id} className={`cl-in flex gap-2 ${conflict ? "-mx-2 rounded bg-bad/10 px-2" : ""}`}>
                  <span className="shrink-0 text-mist/70">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  <span className="shrink-0" style={{ color: b.color }}>▍</span>
                  <span className="min-w-0 break-words" style={{ color: conflict ? "#f87171" : e.kind === "check" ? "#34d399" : e.kind === "status" ? "#f5b843" : "#d4d4dc" }}>
                    <span style={{ color: b.color }}>{b.id}&gt; </span>
                    {body(e)}
                  </span>
                </div>
              );
            })}
            {running && <span className="cl-blink text-ink">▊</span>}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {BOTS.map((b) => {
            const busy = s.busy === b.id;
            return (
              <div key={b.id} className="flex flex-col items-center rounded-xl border px-1 pb-2 pt-2.5 transition-colors" style={{ borderColor: busy ? b.color : "var(--color-line)", background: busy ? `${b.color}14` : "var(--color-panel)" }}>
                <svg viewBox="0 0 100 100" width={40} height={40} aria-hidden className={busy ? "cl-bob" : undefined}>
                  <path d={b.path} fill={b.color} />
                  <ellipse cx={busy ? 42 : 38} cy="52" rx="6" ry={busy ? 9 : 7} fill="#0a0a0c" />
                  <ellipse cx={busy ? 64 : 60} cy="52" rx="6" ry={busy ? 9 : 7} fill="#0a0a0c" />
                </svg>
                <span className="mt-1 text-[12px] font-semibold">{b.name}</span>
                <span className="font-mono text-[10px] text-mist">{b.role}</span>
                <span className="mt-1 font-mono text-[10px]" style={{ color: busy ? b.color : "var(--color-mist)" }}>● {busy ? "working" : running ? "idle" : "done"} · {s.ops[b.id]}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-1 flex-col items-center rounded-xl border border-line bg-panel pb-4">
          <div className="flex w-full items-center gap-2 border-b border-line px-4 py-2 font-mono text-[11.5px] text-mist">
            <span className="text-good">●</span> the app, live · {siteUrl ? siteUrl.replace(/^https?:\/\//, "") : "no URL yet"}
          </div>
          <div className="relative mt-4 h-[520px] w-[262px] rounded-[40px] border border-line-2 bg-[#1a1a20] p-2.5 shadow-2xl shadow-black/60">
            <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-black/60" />
            <div className="relative h-[476px] overflow-hidden rounded-[30px] bg-white">
              {siteUrl ? (
                // The site at phone width (390px), scaled into the frame.
                <iframe title="The site" src={siteUrl} className="absolute left-0 top-0 origin-top-left border-0" style={{ width: 390, height: 708, transform: "scale(0.6205)" }} />
              ) : (
                <div className="grid h-full place-items-center px-6 text-center text-[12px] text-black/50">Connect the site's URL in Setup to watch it here.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "violet" | "bad" | "warn" }) {
  const color = tone === "violet" ? "text-[#a78bfa]" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
      <div className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</div>
      <div className={`mt-0.5 text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
