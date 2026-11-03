"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { liveBook, type BookPolicy, type Concept, type Conflict, type LivePolicy } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { RobotHead, type Sensor } from "./robot-head";

/**
 * The live ingest (gen3-cradle.md §3.2, §5), in two halves: the crew working
 * (the /vision scene) and the book taking shape (the /studio scene), both fed
 * by the crew's real job events. Who is busy comes from each line's speaker
 * ("extractor> …"); the book binds as the lines name its policies, and once the
 * run lands it shows the book itself, with the contradictions waiting for the
 * Policy Walk. The site, live, is one toggle away.
 */

type Ev = { id: number; at: string; kind: "status" | "tool" | "log" | "check"; text: string };
type Line = Ev & { key: string; who: BotId };
type BotId = "lead" | "surveyor" | "extractor" | "clerk" | "gapfinder" | "judge";

const BOTS: { id: BotId; name: string; role: string; color: string; sensor: Sensor }[] = [
  { id: "lead", name: "Team Lead", role: "leads", color: "#e4e4ea", sensor: "bar" },
  { id: "surveyor", name: "Surveyor", role: "maps code", color: "#2dd4bf", sensor: "lens" },
  { id: "extractor", name: "Extractor", role: "finds rules", color: "#8b6cff", sensor: "eyes" },
  { id: "clerk", name: "Clerk", role: "conflicts", color: "#f472b6", sensor: "split" },
  { id: "gapfinder", name: "Gap Finder", role: "holes", color: "#f5b843", sensor: "dots" },
  { id: "judge", name: "Judge", role: "checks", color: "#f43f5e", sensor: "slit" },
];

const BOT = Object.fromEntries(BOTS.map((b) => [b.id, b])) as Record<BotId, (typeof BOTS)[number]>;
const SPEAKER = /^(lead|surveyor|extractor|clerk|gapfinder|judge)>\s*/;

/** The book's phase, from who is speaking: each member of the crew moves the book on a step. */
const PHASES: { title: string; by: BotId[] }[] = [
  { title: "INGEST", by: ["lead"] },
  { title: "MAP", by: ["surveyor"] },
  { title: "EXTRACT", by: ["extractor"] },
  { title: "CONTRADICTIONS", by: ["clerk"] },
  { title: "HOLES", by: ["gapfinder", "judge"] },
  { title: "BOOK", by: [] },
];

/** The studio's ember palette, for the book half. */
const C = { bg: "#0d0806", panel: "#120b08", line: "#3a2620", dim: "#5c4238", wait: "#3b2a22", fog: "#b59a8c", ink: "#f4e6dc", orange: "#f2a03a", gold: "#e8b04a", salmon: "#ec7a5c", pale: "#c9b2a6", pink: "#ff6fa0" };
const TONE: Record<LivePolicy["kind"], string> = { pack: C.salmon, override: C.gold, site: C.pale };
const KIND_LABEL: Record<LivePolicy["kind"], string> = { pack: "pack", override: "override", site: "site's own" };

/** One event can carry several lines (the agent's own text); each line keeps its own speaker. */
function linesOf(events: Ev[]): Line[] {
  return events.flatMap((e) => {
    const parts = e.text.split("\n").map((t) => t.trim()).filter(Boolean);
    const first = e.text.match(SPEAKER)?.[1] as BotId | undefined;
    const fallback: BotId = first ?? (e.kind === "status" ? "lead" : "extractor");
    return parts.map((text, j) => ({ ...e, key: `${e.id}.${j}`, text: text.replace(SPEAKER, ""), who: (text.match(SPEAKER)?.[1] as BotId | undefined) ?? fallback }));
  });
}

export function CradleLive({ siteId, jobId, siteUrl, running, book, conflicts, concepts, onDone }: { siteId: string; jobId: string; siteUrl: string | null; running: boolean; book: BookPolicy[]; conflicts: Conflict[]; concepts: Concept[]; onDone?: () => void }) {
  const api = browserApi();
  const [events, setEvents] = useState<Ev[]>([]);
  const [view, setView] = useState<"book" | "app">("book");
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

  const lines = useMemo(() => linesOf(events), [events]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines.length]);

  // The book has landed once the run is over and the reloaded book carries what was found.
  const landed = !running && book.some((p) => p.extraction != null);
  const live = useMemo(() => liveBook(book, conflicts, lines.map((l) => `${l.who}> ${l.text}`), landed), [book, conflicts, lines, landed]);

  const s = useMemo(() => {
    const ops: Record<BotId, number> = { lead: 0, surveyor: 0, extractor: 0, clerk: 0, gapfinder: 0, judge: 0 };
    let phase = 0;
    for (const l of lines) {
      ops[l.who]++;
      phase = Math.max(phase, PHASES.findIndex((p) => p.by.includes(l.who)));
    }
    const last = lines.at(-1);
    const files = new Set(lines.flatMap((l) => [...l.text.matchAll(/(?:Read\s+)?((?:app|lib|components|pages|src)\/[\w./[\]-]+)/g)].map((m) => m[1]!)));
    return {
      ops,
      busy: running && last ? last.who : null,
      phase: running ? phase : 5,
      files: files.size,
      bound: live.policies.filter((p) => p.state !== "waiting").length,
      holes: lines.filter((l) => /holes?:/.test(l.text)).reduce((n, l) => n + l.text.replace(/^.*holes?:/, "").split("·").filter((x) => x.trim()).length, 0),
    };
  }, [lines, running, live]);

  return (
    <div className="flex flex-col gap-3" data-cradle-live>
      <style>{`
        .cl-in { animation: cl-in .3s ease-out both }
        @keyframes cl-in { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
        .cl-blink { animation: cl-blink 1s steps(2) infinite } @keyframes cl-blink { 50% { opacity: 0 } }
        .cl-spin { animation: cl-spin 6s linear infinite; transform-box: fill-box; transform-origin: center } @keyframes cl-spin { to { transform: rotate(360deg) } }
      `}</style>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Files read" value={`${s.files}`} />
        <Stat label="Policies bound" value={`${s.bound}`} of={`/${live.policies.length}`} tone="violet" />
        <Stat label="Site's own" value={`${live.policies.filter((p) => p.kind === "site" && p.state !== "waiting").length}`} />
        <Stat label="Contradictions" value={`${live.conflicts}`} tone={live.conflicts ? "bad" : undefined} />
        <Stat label="Holes" value={`${s.holes}`} tone={s.holes ? "warn" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* The crew working */}
        <div className="flex min-w-0 flex-col gap-3" data-half="crew">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {BOTS.map((b) => {
              const busy = s.busy === b.id;
              return (
                <div key={b.id} className="flex flex-col items-center rounded-xl border px-1 pb-2 pt-2.5 transition-colors" style={{ borderColor: busy ? b.color : "var(--color-line)", background: busy ? `${b.color}14` : "var(--color-panel)" }}>
                  <RobotHead sensor={b.sensor} color={b.color} busy={busy} />
                  <span className="mt-1 w-full truncate text-center text-[12px] font-semibold">{b.name}</span>
                  <span className="w-full truncate text-center font-mono text-[10px] text-mist">{b.role}</span>
                  <span className="mt-1 w-full truncate text-center font-mono text-[10px]" style={{ color: busy ? b.color : "var(--color-mist)" }}>● {busy ? "working" : running ? "idle" : "done"} · {s.ops[b.id]}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-1 flex-col rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-3 border-b border-line px-4 py-2 font-mono text-[12px]">
              <span className="border-b-2 border-gold-2 pb-1 text-ink">crew.log</span>
              {running ? <span className="text-bad"><span className="cl-blink">●</span> LIVE</span> : <span className="text-good">● done</span>}
              <span className="ml-auto text-mist">tail -f · {lines.length} lines</span>
            </div>
            <div ref={logRef} className="h-[430px] overflow-y-auto px-4 py-3 font-mono text-[12px] leading-[1.75]">
              {lines.map((l) => {
                const b = BOT[l.who];
                const conflict = /CONFLICT|FAIL/.test(l.text);
                return (
                  <div key={l.key} className={`cl-in flex gap-2 ${conflict ? "-mx-2 rounded bg-bad/10 px-2" : ""}`}>
                    <span className="shrink-0 text-mist/70">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="shrink-0" style={{ color: b.color }}>▍</span>
                    <span className="min-w-0 break-words" style={{ color: conflict ? "#f87171" : l.kind === "check" || /✓/.test(l.text) ? "#34d399" : l.kind === "status" ? "#f5b843" : "#d4d4dc" }}>
                      <span style={{ color: b.color }}>{b.id}&gt; </span>
                      {l.text}
                    </span>
                  </div>
                );
              })}
              {running && <span className="cl-blink text-ink">▊</span>}
            </div>
          </div>
        </div>

        {/* The book taking shape */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border font-mono text-[12px]" style={{ borderColor: C.line, background: C.bg, color: C.ink }} data-half="book">
          <div className="flex items-center gap-3 border-b px-4 py-2" style={{ borderColor: C.line }}>
            <span className="font-bold tracking-wide">THE BOOK</span>
            <span style={{ color: C.orange }}>{view === "book" ? `step ${s.phase + 1}/6 · ${s.bound}/${live.policies.length} bound` : siteUrl ? siteUrl.replace(/^https?:\/\//, "") : "no URL yet"}</span>
            <div className="ml-auto flex rounded border" style={{ borderColor: C.line }}>
              {(["book", "app"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className="px-2 py-0.5" style={{ color: view === v ? C.orange : C.dim }}>{v === "book" ? "Book" : "The app, live"}</button>
              ))}
            </div>
          </div>
          {view === "book" ? (
            <>
              <Ring live={live} phase={s.phase} activity={Math.min(1, lines.length / 40)} running={running} landed={landed} busy={s.busy} />
              <div className="grid flex-1 gap-0 border-t sm:grid-cols-2" style={{ borderColor: C.line }}>
                <Groups live={live} concepts={concepts} />
                <Stream live={live} conflicts={conflicts} landed={landed} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 justify-center bg-panel pb-4">
              <div className="relative mt-4 h-[520px] w-[262px] rounded-[40px] border border-line-2 bg-[#1a1a20] p-2.5 shadow-2xl shadow-black/60">
                <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-black/60" />
                <div className="relative h-[476px] overflow-hidden rounded-[30px] bg-white">
                  {siteUrl ? (
                    // The site at phone width (390px), scaled into the frame.
                    <iframe title="The site" src={siteUrl} className="absolute left-0 top-0 origin-top-left border-0" style={{ width: 390, height: 708, transform: "scale(0.6205)" }} />
                  ) : (
                    <div className="grid h-full place-items-center px-6 text-center font-sans text-[12px] text-black/50">Connect the site's URL in Setup to watch it here.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, of, tone }: { label: string; value: string; of?: string; tone?: "violet" | "bad" | "warn" }) {
  const color = tone === "violet" ? "text-[#a78bfa]" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
      <div className="font-mono text-[10.5px] uppercase tracking-widest text-mist">{label}</div>
      <div className={`mt-0.5 text-3xl font-semibold tabular-nums ${color}`}>
        {value}
        {of && <span className="text-xl text-mist">{of}</span>}
      </div>
    </div>
  );
}

// ── The ring: one segment per policy, around the cloud the crew is reading ──
const W = 400, H = 300, CX = 200, CY = 158, R = 90;

function Ring({ live, phase, activity, running, landed, busy }: { live: ReturnType<typeof liveBook>; phase: number; activity: number; running: boolean; landed: boolean; busy: BotId | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ activity, landed, scale: 1 });
  state.current.activity = activity;
  state.current.landed = landed;

  // A seeded cloud of embers in the ring's centre: it thickens as the crew reads and collapses when the book lands.
  const parts = useMemo(() => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const g = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;
    return Array.from({ length: 5200 }, () => ({ x: g() * 1.15, y: g() * 1.15, s: rnd() < 0.05 ? 2.2 : 1.3, a: 0.3 + rnd() * 0.6, w: rnd(), o: rnd() }));
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth, h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
      const st = state.current;
      st.scale += ((st.landed ? 0.32 : 0.55 + st.activity * 0.3) - st.scale) * 0.04;
      // The SVG on top fits a 400×300 box: match its scale and centre.
      const k = Math.min(w / W, h / H), cx = w / 2 + (CX - W / 2) * k, cy = h / 2 + (CY - H / 2) * k, rad = R * k * st.scale;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad * 1.3);
      glow.addColorStop(0, "rgba(255,140,90,0.6)");
      glow.addColorStop(0.5, "rgba(200,40,30,0.25)");
      glow.addColorStop(1, "rgba(120,20,10,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const shown = st.landed ? 1 : 0.25 + st.activity * 0.75;
      for (const p of parts) {
        if (p.o > shown) continue;
        const tw = 0.6 + 0.4 * Math.sin(now / 600 + p.w * 40);
        ctx.fillStyle = p.w > 0.85 ? `rgba(255,214,150,${p.a * tw})` : p.w > 0.4 ? `rgba(255,96,64,${p.a * tw})` : `rgba(190,40,40,${p.a * tw})`;
        ctx.fillRect(cx + p.x * rad, cy + p.y * rad, p.s, p.s);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [parts]);

  const n = Math.max(1, live.policies.length);
  const arc = (i: number) => [(i / n) * Math.PI * 2 - Math.PI / 2 + 0.03, ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.03] as const;
  const pt = (a: number, r: number) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r] as const;
  const at = live.latest ? live.policies.indexOf(live.latest) : -1;
  const bound = live.policies.filter((p) => p.state !== "waiting").length;

  return (
    <div className="relative h-[330px]">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-label={`${bound} of ${live.policies.length} policies bound`}>
        <circle cx={CX} cy={CY} r={R - 9} fill="none" stroke={C.line} />
        {live.policies.map((p, i) => {
          const [a0, a1] = arc(i);
          const color = p.state === "conflict" ? C.pink : p.state === "found" ? TONE[p.kind] : C.wait;
          const hot = i === at && running;
          const ticks = [];
          for (let j = 0; j < 4; j++) {
            const a = a0 + ((a1 - a0) * j) / 3;
            const len = p.state === "waiting" ? 5 : p.state === "conflict" ? 26 : hot ? 24 : 14;
            const [x1, y1] = pt(a, R + 7), [x2, y2] = pt(a, R + 7 + len);
            ticks.push(<line key={j} x1={x1} y1={y1} x2={x2} y2={y2} stroke={hot ? C.orange : color} strokeOpacity={p.state === "waiting" ? 0.7 : 0.85} strokeWidth="1.2" />);
          }
          const [sx, sy] = pt(a0, R), [ex, ey] = pt(a1, R);
          return (
            <g key={p.key} data-ring={p.state}>
              <path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}`} fill="none" stroke={hot ? C.orange : color} strokeWidth={p.state === "conflict" ? 6 : 4} style={{ transition: "stroke .5s" }} />
              {ticks}
            </g>
          );
        })}
        {at >= 0 && running && (() => {
          const [a0, a1] = arc(at);
          const [x, y] = pt((a0 + a1) / 2, R);
          return (
            <g transform={`translate(${x} ${y})`}>
              <g className="cl-spin">
                <circle r="16" fill="none" stroke={C.orange} strokeDasharray="7 5" />
                <circle r="9" fill="none" stroke={C.orange} strokeOpacity="0.7" />
              </g>
              <circle r="2.5" fill={C.orange} />
            </g>
          );
        })()}
        {landed ? (
          <g className="cl-in" textAnchor="middle" stroke={C.bg} strokeWidth="5" paintOrder="stroke" strokeLinejoin="round">
            <circle cx={CX} cy={CY + 8} r="48" fill={C.bg} fillOpacity="0.55" stroke="none" />
            <text x={CX} y={CY - 2} fontSize="40" fontWeight="700" fill={C.ink}>{bound}</text>
            <text x={CX} y={CY + 16} fontSize="10" fill={C.fog}>policies found in code</text>
            {live.conflicts > 0 && <text x={CX} y={CY + 32} fontSize="11" fontWeight="700" fill={C.pink}>{live.conflicts} contradiction{live.conflicts === 1 ? "" : "s"} for you</text>}
          </g>
        ) : (
          <g textAnchor="middle" stroke={C.bg} strokeWidth="5" paintOrder="stroke" strokeLinejoin="round">
            <text x={CX} y={CY + 4} fontSize="22" fontWeight="700" fill={C.ink} fillOpacity="0.9">{bound}<tspan fontSize="13" fill={C.fog}>/{live.policies.length}</tspan></text>
          </g>
        )}
      </svg>

      <div className="absolute left-3 top-2.5 z-10 border-l-2 pl-2.5" style={{ borderColor: C.orange }}>
        <div key={phase} className="cl-in text-[15px] font-bold">0{phase + 1} · {PHASES[phase]!.title}</div>
        <div style={{ color: C.orange }}>{landed || !running ? "ready for the Policy Walk" : busy ? `${BOT[busy].name} · ${BOT[busy].role}` : "waiting for the crew"}</div>
      </div>
      {live.latest && running && (
        <div key={live.latest.key} className="cl-in absolute bottom-2.5 right-3 z-10 w-[200px] border px-2.5 py-1.5" style={{ borderColor: C.orange, background: "#160d09ee" }}>
          <div className="flex font-bold"><span className="truncate">{live.latest.key.startsWith("new-") ? "NEW" : live.latest.key}</span><span className="ml-auto" style={{ color: live.latest.state === "conflict" ? C.pink : TONE[live.latest.kind] }}>{live.latest.state === "conflict" ? "conflict" : KIND_LABEL[live.latest.kind]}</span></div>
          <div className="truncate" style={{ color: C.orange }}>{live.latest.title}</div>
        </div>
      )}
      <div className="absolute bottom-2.5 left-3 z-10 flex flex-col gap-0.5 text-[10.5px]" style={{ color: C.fog }}>
        {([["pack", C.salmon], ["override", C.gold], ["site's own", C.pale], ["contradiction", C.pink], ["not found yet", C.wait]] as const).map(([l, c]) => (
          <span key={l} className="flex items-center gap-1.5"><span className="h-1.5 w-3" style={{ background: c }} />{l}</span>
        ))}
      </div>
    </div>
  );
}

function Groups({ live, concepts }: { live: ReturnType<typeof liveBook>; concepts: Concept[] }) {
  const label = (key: string) => (key === "new" ? "site's own, new" : concepts.find((c) => c.key === key)?.label ?? key);
  const keys = [...new Set(live.policies.map((p) => p.concept))];
  const hot = live.latest?.concept;
  return (
    <div className="border-b p-3 sm:border-b-0 sm:border-r" style={{ borderColor: C.line }}>
      <div className="mb-1.5 flex"><span className="font-bold">GROUPS</span><span className="ml-auto" style={{ color: C.salmon }}>{keys.length}</span></div>
      {keys.map((key) => {
        const all = live.policies.filter((p) => p.concept === key);
        const on = all.filter((p) => p.state !== "waiting");
        return (
          <div key={key} className="flex items-center gap-2 leading-[1.7]">
            <span className="w-[112px] truncate" style={{ color: key === hot ? C.orange : C.ink }}>{label(key)}</span>
            <span className="h-1.5 flex-1" style={{ background: "#2a1b16" }}><span className="block h-full transition-all duration-500" style={{ width: `${(on.length / all.length) * 100}%`, background: all.some((p) => p.state === "conflict") ? C.pink : C.gold }} /></span>
            <span className="w-9 text-right tabular-nums" style={{ color: C.fog }}>{on.length}/{all.length}</span>
          </div>
        );
      })}
    </div>
  );
}

function Stream({ live, conflicts, landed }: { live: ReturnType<typeof liveBook>; conflicts: Conflict[]; landed: boolean }) {
  if (landed) {
    const open = conflicts.filter((c) => c.status === "open");
    return (
      <div className="p-3">
        <div className="mb-1.5 flex"><span className="font-bold">FOR YOU</span><span className="ml-auto" style={{ color: open.length ? C.pink : C.gold }}>{open.length} contradiction{open.length === 1 ? "" : "s"}</span></div>
        {open.slice(0, 4).map((c) => (
          <div key={c.id} className="mb-1 flex gap-2 leading-snug">
            <span className="mt-1 h-2 w-2 shrink-0" style={{ background: C.pink }} />
            <span className="line-clamp-2" style={{ color: C.fog }}>{c.why}</span>
          </div>
        ))}
        {!open.length && <div style={{ color: C.fog }}>No contradictions. Confirm the critical policies next.</div>}
        <button type="button" className="mt-2 w-full border px-2 py-1 font-bold" style={{ borderColor: C.orange, color: C.orange }} onClick={() => document.getElementById("policy-walk")?.scrollIntoView({ behavior: "smooth" })}>
          Start the Policy Walk ↓
        </button>
      </div>
    );
  }
  const bound = live.policies.filter((p) => p.line != null).sort((a, b) => a.line! - b.line!).slice(-7);
  return (
    <div className="p-3">
      <div className="mb-1.5 flex"><span className="font-bold">STREAM</span><span className="ml-auto" style={{ color: C.orange }}>live</span></div>
      {bound.length === 0 && <div style={{ color: C.fog }}>Policies appear here as the crew finds them.</div>}
      {bound.map((p) => (
        <div key={p.key} className="cl-in flex items-center gap-2 leading-[1.7]" style={{ background: p === live.latest ? "#2a1610" : undefined }}>
          <span className="h-2 w-2 shrink-0" style={{ background: p.state === "conflict" ? C.pink : TONE[p.kind] }} />
          <span className="min-w-0 flex-1 truncate font-bold" style={{ color: p === live.latest ? C.orange : C.ink }}>{p.title}</span>
          <span className="shrink-0" style={{ color: p.state === "conflict" ? C.pink : C.fog }}>{p.state === "conflict" ? "conflict" : KIND_LABEL[p.kind]}</span>
        </div>
      ))}
    </div>
  );
}
