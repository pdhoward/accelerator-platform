"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * /vision — a prototype for reflection, not a product screen.
 *
 * A re-staging of the "grok-agent" video (a crew of bots running an old phone
 * overnight) in the Accelerator's world: a crew working Sally's backlog for
 * Machine Shop while she sleeps. Same anatomy — the crew panel, the counters,
 * the live log, the queue, a mirror of the thing being changed, and a receipt
 * at the end — plus the piece the video doesn't have: work that stops and
 * waits for the owner. Everything here is a scripted simulation.
 */

// ── The crew ───────────────────────────────────────────────────────────────
type BotId = "lead" | "surveyor" | "builder" | "tester" | "judge" | "release";
type BotState = "idle" | "planning" | "reading" | "editing" | "testing" | "checking" | "shipping" | "done";

const BOTS: { id: BotId; name: string; role: string; color: string; shape: "circle" | "star" | "cloud" | "heart" | "triangle" | "drop" }[] = [
  { id: "lead", name: "Team Lead", role: "plans", color: "#f3f3f6", shape: "circle" },
  { id: "surveyor", name: "Surveyor", role: "reads code", color: "#2dd4bf", shape: "star" },
  { id: "builder", name: "Builder", role: "edits", color: "#8b6cff", shape: "cloud" },
  { id: "tester", name: "Tester", role: "runs tests", color: "#f472b6", shape: "heart" },
  { id: "judge", name: "Judge", role: "verifies", color: "#f43f5e", shape: "triangle" },
  { id: "release", name: "Release", role: "ships", color: "#f5b843", shape: "drop" },
];
const BOT = Object.fromEntries(BOTS.map((b) => [b.id, b])) as Record<BotId, (typeof BOTS)[number]>;

function Bot({ id, state, size = 64 }: { id: BotId; state: BotState; size?: number }) {
  const b = BOT[id];
  const busy = state !== "idle" && state !== "done";
  const path: Record<(typeof BOTS)[number]["shape"], string> = {
    circle: "M50 8a42 42 0 1 1 0 84a42 42 0 1 1 0-84z",
    star: "M50 4l11 22 24-6-6 24 17 14-21 11 4 24-23-7-13 21-12-21-24 7 4-24-21-11 17-14-6-24 24 6z",
    cloud: "M30 84c-16 0-24-12-22-24 2-11 11-16 19-15 2-15 15-26 30-24 13 2 22 12 22 24 11 1 17 10 15 20-2 11-11 19-23 19z",
    heart: "M50 90C18 66 6 50 6 33 6 19 17 9 30 9c9 0 16 5 20 12 4-7 11-12 20-12 13 0 24 10 24 24 0 17-12 33-44 57z",
    triangle: "M50 6c4 0 7 2 9 6l35 66c4 8-1 16-10 16H16c-9 0-14-8-10-16l35-66c2-4 5-6 9-6z",
    drop: "M50 6c14 20 36 38 36 58a36 36 0 0 1-72 0C14 44 36 26 50 6z",
  };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className={busy ? "vision-bob" : undefined}>
      <path d={path[b.shape]} fill={b.color} />
      {state === "done" ? (
        <g fill="#0a0a0c">
          <path d="M33 52q6-8 12 0" stroke="#0a0a0c" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M55 52q6-8 12 0" stroke="#0a0a0c" strokeWidth="5" fill="none" strokeLinecap="round" />
        </g>
      ) : (
        <g fill="#0a0a0c">
          <ellipse cx={busy ? 42 : 38} cy="52" rx="6" ry={busy ? 9 : 7} />
          <ellipse cx={busy ? 64 : 60} cy="52" rx="6" ry={busy ? 9 : 7} />
        </g>
      )}
    </svg>
  );
}

// ── The backlog: Sally's work orders, rated by what is at stake ─────────────
type Rating = "Low" | "Medium" | "High";
type Item = {
  n: number;
  title: string;
  area: "catalog" | "search" | "content" | "checkout" | "speed" | "assistant" | "data";
  rating: Rating;
  why: string;
  files: string[];
  addsTests: number;
  cost: number;
  screen: Screen;
  /** Where on the phone the builder works, in percent. */
  at: [number, number];
  /** The night's outcome for this item. */
  outcome: "shipped" | "preview" | "waiting";
  /** The Judge catches something and the Builder repairs it. */
  catches?: { fail: string; fix: string };
};
type Screen = "lock" | "home" | "product" | "search" | "sheet";

const ITEMS: Item[] = [
  { n: 1, title: "Sharpen product images on phones", area: "catalog", rating: "Low", why: "display only", files: ["components/product-card.tsx"], addsTests: 2, cost: 0.62, screen: "home", at: [30, 38], outcome: "shipped" },
  { n: 2, title: "In-stock badge on every card", area: "catalog", rating: "Low", why: "display only", files: ["components/product-card.tsx", "lib/product.ts"], addsTests: 3, cost: 0.71, screen: "home", at: [70, 52], outcome: "shipped" },
  { n: 3, title: "Spec sheet: add the warranty line", area: "content", rating: "Low", why: "copy from the catalog", files: ["app/p/[id]/sheet/print-sheet.tsx"], addsTests: 1, cost: 0.38, screen: "sheet", at: [50, 64], outcome: "shipped" },
  {
    n: 4, title: "Show shipping total on the product page", area: "checkout", rating: "Low", why: "display of an existing rule", files: ["app/p/[id]/page.tsx", "lib/checkout.ts"], addsTests: 3, cost: 1.12, screen: "product", at: [50, 71], outcome: "shipped",
    catches: { fail: "1 test failing · total shows $146.6 ≠ $146.58 (rounding)", fix: "format cents with the catalog's money helper" },
  },
  { n: 5, title: "Search: match brand names", area: "search", rating: "Medium", why: "changes how search reads the catalog · brief approved yesterday", files: ["lib/catalog.ts", "components/search-box.tsx"], addsTests: 4, cost: 1.86, screen: "search", at: [50, 22], outcome: "preview" },
  { n: 6, title: "Fix the typo in the footer", area: "content", rating: "Low", why: "copy only", files: ["app/layout.tsx"], addsTests: 0, cost: 0.12, screen: "home", at: [50, 93], outcome: "shipped" },
  { n: 7, title: "Lazy-load images below the fold", area: "speed", rating: "Low", why: "no behavior change", files: ["components/gallery.tsx"], addsTests: 1, cost: 0.54, screen: "home", at: [50, 80], outcome: "shipped" },
  { n: 8, title: "Lower flat shipping to $7.95", area: "checkout", rating: "High", why: "money moves · owner decides", files: [], addsTests: 0, cost: 0.31, screen: "product", at: [50, 71], outcome: "waiting" },
  { n: 9, title: "Assistant: answer warranty questions", area: "assistant", rating: "Low", why: "reads the catalog only", files: ["lib/assistant-tools.ts"], addsTests: 2, cost: 0.96, screen: "product", at: [80, 88], outcome: "shipped" },
  { n: 10, title: "Restock alerts: collect shopper emails", area: "data", rating: "High", why: "personal data · owner decides", files: [], addsTests: 0, cost: 0.44, screen: "product", at: [50, 62], outcome: "waiting" },
  { n: 11, title: "Alt text on 40 product images", area: "catalog", rating: "Low", why: "accessibility, display only", files: ["components/product-card.tsx"], addsTests: 1, cost: 0.58, screen: "home", at: [30, 60], outcome: "shipped" },
  { n: 12, title: "Sitemap for search engines", area: "speed", rating: "Low", why: "new route, no data", files: ["app/sitemap.ts"], addsTests: 2, cost: 0.47, screen: "home", at: [50, 15], outcome: "shipped" },
];
const BASE_TESTS = 276;

// ── The script: a timeline of events, built from the backlog ────────────────
type Event = {
  t: number;
  who?: BotId;
  log?: string;
  tone?: "ok" | "fail" | "wait" | "plain" | "cmd";
  bots?: Partial<Record<BotId, BotState>>;
  item?: { n: number; status: "doing" | "done" | "preview" | "waiting" };
  cursor?: { who: BotId; x: number; y: number; screen: Screen } | null;
  tests?: number;
  ops?: Partial<Record<BotId, number>>;
  cost?: number;
  caught?: number;
  files?: number;
};

function buildScript(): { events: Event[]; length: number } {
  const ev: Event[] = [];
  let t = 600;
  let tests = BASE_TESTS;
  const say = (dt: number, e: Omit<Event, "t">) => {
    t += dt;
    ev.push({ t, ...e });
  };
  say(0, { who: "lead", log: "$ accelerator crew start machine-shop --mode overnight", tone: "cmd", bots: { lead: "planning" } });
  say(500, { who: "lead", log: "site: machine-shop · stage branch · preview ready · 276 tests baseline" });
  say(450, { who: "surveyor", log: "census: 57 files · 184 functions · 13 routes · 16 test files", bots: { surveyor: "reading" }, ops: { surveyor: 1 } });
  say(450, { who: "judge", log: "armed · typecheck · full suite · production build · money rules", tone: "ok", bots: { judge: "checking", surveyor: "idle" }, ops: { judge: 1 } });
  say(450, { who: "lead", log: 'mandate: "keep the shop improving while I sleep" · budget $40 · Sally', bots: { judge: "idle" } });
  say(450, { who: "lead", log: "rated 12 work orders: 9 low · 1 medium · 2 high", ops: { lead: 1 } });
  say(450, { who: "lead", log: "high = money or personal data → plan only, then wait for Sally", tone: "wait" });

  for (const it of ITEMS) {
    say(700, { who: "lead", log: `#${it.n} ${it.title} · ${it.rating} · ${it.why}`, item: { n: it.n, status: "doing" }, bots: { lead: "planning" }, ops: { lead: 1 } });
    if (it.outcome === "waiting") {
      say(550, { who: "surveyor", log: `read ${it.area === "checkout" ? "lib/checkout.ts · shipping rule $9.95" : "privacy notice · no email store yet"}`, bots: { surveyor: "reading", lead: "idle" }, ops: { surveyor: 1 }, cursor: { who: "surveyor", x: it.at[0], y: it.at[1], screen: it.screen } });
      say(600, { who: "lead", log: `#${it.n} design drafted · waits for Sally's approval · nothing built`, tone: "wait", item: { n: it.n, status: "waiting" }, bots: { surveyor: "idle" }, cost: it.cost });
      continue;
    }
    say(450, { who: "surveyor", log: `read ${it.files.join(" · ")}`, bots: { surveyor: "reading", lead: "idle" }, ops: { surveyor: 1 }, cursor: { who: "surveyor", x: it.at[0], y: it.at[1], screen: it.screen } });
    say(550, { who: "builder", log: `edit ${it.files[0]}${it.addsTests ? ` · +${it.addsTests} test${it.addsTests === 1 ? "" : "s"}` : ""}`, bots: { builder: "editing", surveyor: "idle" }, ops: { builder: 2 }, files: it.files.length, cursor: { who: "builder", x: it.at[0] + 4, y: it.at[1] + 3, screen: it.screen } });
    say(600, { who: "tester", log: `$ pnpm test · ${tests + it.addsTests} tests`, tone: "cmd", bots: { tester: "testing", builder: "idle" }, ops: { tester: 1 } });
    if (it.catches) {
      say(650, { who: "judge", log: `FAIL ${it.catches.fail}`, tone: "fail", bots: { judge: "checking", tester: "idle" }, ops: { judge: 1 }, caught: 1 });
      say(550, { who: "builder", log: `repair: ${it.catches.fix}`, bots: { builder: "editing", judge: "idle" }, ops: { builder: 1 }, cursor: { who: "builder", x: it.at[0] - 6, y: it.at[1], screen: it.screen } });
      say(600, { who: "tester", log: `$ pnpm test · ${tests + it.addsTests} tests`, tone: "cmd", bots: { tester: "testing", builder: "idle" }, ops: { tester: 1 } });
    }
    tests += it.addsTests;
    say(600, { who: "judge", log: `OK · typecheck · ${tests}/${tests} · build`, tone: "ok", bots: { judge: "checking", tester: "idle" }, ops: { judge: 1 }, tests });
    if (it.outcome === "preview") {
      say(550, { who: "release", log: `#${it.n} preview up · brief approved · waits for Sally's Ship it`, tone: "wait", bots: { release: "shipping", judge: "idle" }, ops: { release: 1 }, item: { n: it.n, status: "preview" }, cost: it.cost });
      say(250, { bots: { release: "idle" } });
    } else {
      say(550, { who: "release", log: `#${it.n} live · main fast-forward · site answers 200`, tone: "ok", bots: { release: "shipping", judge: "idle" }, ops: { release: 1 }, item: { n: it.n, status: "done" }, cost: it.cost });
      say(250, { bots: { release: "idle" } });
    }
  }
  say(700, { who: "lead", log: "record: 12 work packages written to docs/accelerator/ · ledger 148 entries", ops: { lead: 1 }, cursor: null });
  say(500, { who: "judge", log: `${tests}/${tests} on main · 1 caught · 0 errors`, tone: "ok", ops: { judge: 1 } });
  say(500, { who: "lead", log: "briefing for Sally: 9 shipped · 1 preview to try · 2 decisions waiting", tone: "wait" });
  say(400, { bots: { lead: "done", surveyor: "done", builder: "done", tester: "done", judge: "done", release: "done" } });
  for (let i = 0; i < 3; i++) say(700, { who: "lead", log: `heartbeat · crew idle · 0 errors · budget held` });
  return { events: ev, length: t + 600 };
}

// ── Derived state at time t ─────────────────────────────────────────────────
type Derived = {
  log: Event[];
  bots: Record<BotId, BotState>;
  ops: Record<BotId, number>;
  status: Record<number, "todo" | "doing" | "done" | "preview" | "waiting">;
  cursor: Event["cursor"];
  screen: Screen;
  tests: number;
  cost: number;
  caught: number;
  files: number;
  failingNow: boolean;
};

function derive(events: Event[], t: number): Derived {
  const d: Derived = {
    log: [], bots: { lead: "idle", surveyor: "idle", builder: "idle", tester: "idle", judge: "idle", release: "idle" },
    ops: { lead: 0, surveyor: 0, builder: 0, tester: 0, judge: 0, release: 0 }, status: Object.fromEntries(ITEMS.map((i) => [i.n, "todo"])),
    cursor: null, screen: "lock", tests: BASE_TESTS, cost: 0, caught: 0, files: 0, failingNow: false,
  };
  for (const e of events) {
    if (e.t > t) break;
    if (e.log) d.log.push(e);
    if (e.bots) Object.assign(d.bots, e.bots);
    if (e.ops) for (const [k, v] of Object.entries(e.ops)) d.ops[k as BotId] += v ?? 0;
    if (e.item) d.status[e.item.n] = e.item.status;
    if (e.cursor !== undefined) {
      d.cursor = e.cursor;
      if (e.cursor) d.screen = e.cursor.screen;
    }
    if (e.tests) d.tests = e.tests;
    if (e.cost) d.cost += e.cost;
    if (e.caught) d.caught += e.caught;
    if (e.files) d.files += e.files;
    d.failingNow = e.tone === "fail" ? true : e.tone === "ok" ? false : d.failingNow;
  }
  if (Object.values(d.bots).every((s) => s === "done")) d.screen = "lock";
  return d;
}

const COLOR: Record<NonNullable<Event["tone"]>, string> = { ok: "#34d399", fail: "#f87171", wait: "#f5b843", plain: "#a9a9b2", cmd: "#c4b5fd" };

/** 01:00 AM → 06:12 AM across the script. */
function clock(t: number, length: number) {
  const minutes = 60 + Math.round((t / length) * 312);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} AM`;
}

// ── The page ────────────────────────────────────────────────────────────────
export default function VisionPage() {
  const { events, length } = useMemo(buildScript, []);
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState(2);
  const [playing, setPlaying] = useState(true);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const step = (now: number) => {
      if (last.current != null) setT((x) => Math.min(length, x + (now - last.current!) * speed));
      last.current = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed, length]);

  const d = useMemo(() => derive(events, t), [events, t]);
  const done = Object.values(d.status).filter((s) => s === "done").length;
  const waiting = ITEMS.filter((i) => d.status[i.n] === "waiting" || d.status[i.n] === "preview");
  const finished = Object.values(d.bots).every((s) => s === "done");
  const shipped = (n: number) => d.status[n] === "done";
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [d.log.length]);
  const elapsed = Math.floor(t / 1000);

  return (
    <div className="min-h-screen bg-[#0b0b0f] px-4 py-5 font-sans text-ink sm:px-8">
      <style>{`
        .vision-bob { animation: vision-bob 0.9s ease-in-out infinite; }
        @keyframes vision-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        .vision-in { animation: vision-in 0.35s ease-out both; }
        @keyframes vision-in { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        .vision-blink { animation: vision-blink 1s steps(2) infinite; }
        @keyframes vision-blink { 50% { opacity: 0 } }
      `}</style>

      {/* Header */}
      <header className="mx-auto mb-4 flex max-w-[1400px] flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg border border-gold/50 font-mono text-sm text-gold-2">&gt;_</span>
        <span className="text-xl font-semibold tracking-tight">accelerator</span>
        <span className="font-mono text-sm text-mist">· site: <span className="text-fog">machine-shop</span> · crew of 6 · overnight</span>
        <div className="ml-auto flex flex-wrap items-center gap-3 font-mono text-sm">
          <span className="rounded-md border border-bad/40 px-2 py-0.5 text-bad"><span className="vision-blink">●</span> LIVE</span>
          <span className="text-fog">{clock(t, length)}</span>
          <span className="text-mist">budget</span>
          <span className="tabular-nums text-ink">${d.cost.toFixed(2)}</span>
          <span className="text-mist">/ $40</span>
          <div className="flex items-center gap-1 rounded-md border border-line px-1 py-0.5">
            <button type="button" className="px-2 text-fog hover:text-ink" onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</button>
            <button type="button" className="px-2 text-fog hover:text-ink" onClick={() => { setT(0); setPlaying(true); }}>replay</button>
            {[1, 2, 4].map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)} className={`rounded px-2 ${speed === s ? "bg-violet/30 text-ink" : "text-mist hover:text-ink"}`}>{s}×</button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 lg:grid-cols-[1.05fr_1fr]">
        {/* Left column */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Work orders" value={`${done}`} of={`/${ITEMS.length}`} note={waiting.length ? `${waiting.length} waiting for Sally` : "queued: 12"} accent={done > 0} />
            <Stat label="Tests passing" value={`${d.tests}`} note={`baseline ${BASE_TESTS} · +${d.tests - BASE_TESTS}`} violet />
            <Stat label="Files changed" value={`${d.files}`} note="each one tested" />
            <Stat label="Judge caught" value={`${d.caught}`} note={d.caught ? "rounding → repaired" : "0 so far"} bad={d.failingNow} />
          </div>
          <div className="flex gap-1" aria-hidden>
            {ITEMS.map((i) => (
              <span key={i.n} className={`h-2 flex-1 rounded-sm ${d.status[i.n] === "done" ? "bg-gold-2" : d.status[i.n] === "doing" ? "bg-violet" : d.status[i.n] === "todo" ? "bg-line" : "bg-warn/50"}`} />
            ))}
          </div>

          <section className="flex min-h-0 flex-col rounded-xl border border-line bg-panel">
            <div className="flex items-center gap-4 border-b border-line px-4 py-2 font-mono text-[12.5px]">
              <span className="border-b-2 border-gold-2 pb-1 text-ink">crew.log</span>
              <span className="pb-1 text-mist">git</span>
              <span className="pb-1 text-mist">tests</span>
              <span className="ml-auto text-mist">tail -f · {d.log.length} lines</span>
            </div>
            <div ref={logRef} className="h-[380px] overflow-hidden px-4 py-3 font-mono text-[12.5px] leading-[1.75]">
              {d.log.map((e, i) => (
                <div key={i} className={`vision-in flex gap-2 ${e.tone === "fail" ? "-mx-2 rounded bg-bad/10 px-2" : ""}`}>
                  <span className="shrink-0 text-mist/70">{clock(e.t, length).slice(0, 5)}</span>
                  <span className="shrink-0" style={{ color: e.who ? BOT[e.who].color : "#6f6f7b" }}>▍</span>
                  <span className="min-w-0 truncate" style={{ color: e.tone ? COLOR[e.tone] : "#d4d4dc" }}>
                    {e.who && e.tone !== "cmd" && <span style={{ color: BOT[e.who].color }}>{BOT[e.who].name.toLowerCase().replace(" ", "")}&gt; </span>}
                    {e.log}
                  </span>
                </div>
              ))}
              {!finished && <span className="vision-blink text-ink">▊</span>}
            </div>
          </section>

          {finished ? (
            <Receipt d={d} done={done} waiting={waiting} />
          ) : (
            <section className="rounded-xl border border-line bg-panel px-4 py-3">
              <div className="mb-2 flex font-mono text-[12px] uppercase tracking-widest text-mist">
                <span>Work queue</span>
                <span className="ml-auto text-fog">{done}/{ITEMS.length}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {(() => {
                  // A five-row window around the item in progress.
                  const at = Math.max(0, ITEMS.findIndex((i) => d.status[i.n] === "doing"));
                  const from = Math.min(Math.max(0, at - 2), ITEMS.length - 5);
                  return ITEMS.slice(from, from + 5).map((i) => <QueueRow key={i.n} item={i} status={d.status[i.n]!} />);
                })()}
              </ul>
            </section>
          )}
        </div>

        {/* Right column */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {BOTS.map((b) => {
              const s = d.bots[b.id];
              const busy = s !== "idle" && s !== "done";
              return (
                <div key={b.id} className="flex flex-col items-center rounded-xl border px-1 pb-2 pt-3 transition-colors" style={{ borderColor: busy ? b.color : "#26262e", background: busy ? `${b.color}14` : "#121216" }}>
                  <Bot id={b.id} state={s} size={52} />
                  <span className="mt-1 text-[13px] font-semibold">{b.name}</span>
                  <span className="font-mono text-[10.5px] text-mist">{b.role}</span>
                  <span className="mt-1.5 rounded px-1.5 font-mono text-[10.5px]" style={{ color: s === "done" ? "#34d399" : busy ? b.color : "#6f6f7b" }}>● {s}</span>
                  <span className="font-mono text-[10px] text-mist">ops {d.ops[b.id]}</span>
                </div>
              );
            })}
          </div>

          <section className="flex flex-1 flex-col items-center rounded-xl border border-line bg-panel pb-4">
            <div className="flex w-full items-center gap-2 border-b border-line px-4 py-2 font-mono text-[12px] text-mist">
              <span className="text-good">●</span> <span className="text-fog">machine-shop</span> · preview mirror · 390×844
            </div>
            <Phone screen={d.screen} cursor={d.cursor} shipped={shipped} finished={finished} summary={`${done} shipped · ${d.caught} caught · ${waiting.length} waiting for you`} />
          </section>
        </div>
      </div>
      <p className="mx-auto mt-4 max-w-[1400px] text-center font-mono text-[11px] text-mist">
        A scripted simulation for reflection. Modelled on the grok-agent video, restaged as an Accelerator crew working Machine Shop overnight.
      </p>
    </div>
  );
}

function Stat({ label, value, of, note, accent, violet, bad }: { label: string; value: string; of?: string; note: string; accent?: boolean; violet?: boolean; bad?: boolean }) {
  return (
    <div className={`rounded-xl border bg-panel px-4 py-3 transition-colors ${bad ? "border-bad/60" : accent ? "border-gold/40" : violet ? "border-violet/40" : "border-line"}`}>
      <div className="font-mono text-[11px] uppercase tracking-widest text-mist">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className={`text-4xl font-semibold tabular-nums ${violet ? "text-[#a78bfa]" : ""}`}>
          {value}
          {of && <span className="text-2xl text-mist">{of}</span>}
        </span>
        <span className="truncate font-mono text-[11px] text-mist">{note}</span>
      </div>
    </div>
  );
}

const AREA_COLOR: Record<Item["area"], string> = { catalog: "#2dd4bf", search: "#8b6cff", content: "#a9a9b2", checkout: "#f5b843", speed: "#22d3ee", assistant: "#f472b6", data: "#f43f5e" };

function QueueRow({ item, status }: { item: Item; status: Derived["status"][number] }) {
  const icon = status === "done" ? "✓" : status === "doing" ? "◌" : status === "waiting" ? "⏸" : status === "preview" ? "◐" : "○";
  return (
    <li className={`flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13.5px] ${status === "doing" ? "border border-gold/50 bg-gold/5" : status === "waiting" || status === "preview" ? "border border-warn/30 bg-warn/5" : "border border-transparent"}`}>
      <span className={`w-4 text-center ${status === "done" ? "text-good" : status === "doing" ? "vision-bob text-gold-2" : status === "todo" ? "text-mist" : "text-warn"}`}>{icon}</span>
      <span className="w-6 font-mono text-[11px] text-mist">{String(item.n).padStart(2, "0")}</span>
      <span className={`min-w-0 flex-1 truncate ${status === "todo" ? "text-mist" : ""}`}>{item.title}</span>
      <span className={`rounded px-1.5 font-mono text-[10.5px] ${item.rating === "High" ? "text-bad" : item.rating === "Medium" ? "text-warn" : "text-mist"}`}>{item.rating}</span>
      <span className="w-16 text-right font-mono text-[11px]" style={{ color: AREA_COLOR[item.area] }}>{item.area}</span>
    </li>
  );
}

function Receipt({ d, done, waiting }: { d: Derived; done: number; waiting: Item[] }) {
  const areas = Object.entries(ITEMS.filter((i) => d.status[i.n] === "done").reduce<Record<string, number>>((a, i) => ({ ...a, [i.area]: (a[i.area] ?? 0) + 1 }), {}));
  return (
    <section className="vision-in rounded-xl border border-good/30 bg-gradient-to-b from-good/[0.06] to-transparent px-5 py-4">
      <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-widest text-good">
        <Bot id="lead" state="done" size={22} /> Session complete · 06:12 AM
      </div>
      <div className="mt-2 text-4xl font-semibold tracking-tight">{done} work orders shipped</div>
      <div className="text-xl text-fog">
        while Sally slept · <span className="text-good">0 errors</span> · <span className="text-bad">{d.caught} caught by the Judge</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {areas.map(([a, n]) => (
          <span key={a} className="rounded-md border border-line px-2 py-0.5 text-[13px]">{a} <span style={{ color: AREA_COLOR[a as Item["area"]] }}>{n}</span></span>
        ))}
        <span className="rounded-md border border-line px-2 py-0.5 text-[13px]">tests <span className="text-[#a78bfa]">{BASE_TESTS} → {d.tests}</span></span>
      </div>
      <div className="mt-4 rounded-lg border border-warn/40 bg-warn/[0.06] px-3 py-2.5">
        <div className="font-mono text-[11px] uppercase tracking-widest text-warn">Waiting for you · {waiting.length}</div>
        <ul className="mt-1.5 flex flex-col gap-1 text-[13.5px]">
          {waiting.map((i) => (
            <li key={i.n} className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-mist">#{i.n}</span>
              <span className="flex-1">{i.title}</span>
              <span className="font-mono text-[11px] text-warn">{d.status[i.n] === "preview" ? "try the preview · ship it?" : `${i.why.split(" · ")[0]} · approve the design?`}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 grid grid-cols-6 gap-1.5">
        {BOTS.map((b) => (
          <div key={b.id} className="flex flex-col items-center rounded-lg border border-line py-1.5">
            <Bot id={b.id} state="done" size={26} />
            <span className="text-[11px] font-semibold">{b.name}</span>
            <span className="font-mono text-[10px] text-mist">{d.ops[b.id]} ops</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 font-mono text-[12px] text-mist">
        budget ${d.cost.toFixed(2)} of $40
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-gold-2" style={{ width: `${(d.cost / 40) * 100}%` }} /></span>
        every change on the record
      </div>
    </section>
  );
}

// ── The mirror: Machine Shop on a phone, changing as work ships ──────────────
function Phone({ screen, cursor, shipped, finished, summary }: { screen: Screen; cursor: Derived["cursor"]; shipped: (n: number) => boolean; finished: boolean; summary: string }) {
  return (
    <div className="relative mt-4 h-[600px] w-[300px] rounded-[44px] border border-line-2 bg-[#1a1a20] p-3 shadow-2xl shadow-black/60">
      <div className="mx-auto mb-2 h-1.5 w-20 rounded-full bg-black/60" />
      <div className="relative h-[548px] overflow-hidden rounded-[32px] bg-[#f6f5f2] text-[#16161a]">
        {screen === "lock" && <LockScreen finished={finished} summary={summary} />}
        {screen === "home" && <HomeScreen shipped={shipped} />}
        {screen === "product" && <ProductScreen shipped={shipped} />}
        {screen === "search" && <SearchScreen />}
        {screen === "sheet" && <SheetScreen shipped={shipped} />}
        {cursor && (
          <div className="pointer-events-none absolute transition-all duration-700 ease-out" style={{ left: `${cursor.x}%`, top: `${cursor.y}%` }}>
            <svg width="18" height="18" viewBox="0 0 24 24" className="drop-shadow"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#16161a" stroke="#fff" strokeWidth="1.5" /></svg>
            <span className="absolute left-4 top-4 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[#0a0a0c]" style={{ background: BOT[cursor.who].color }}>{BOT[cursor.who].name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function LockScreen({ finished, summary }: { finished: boolean; summary: string }) {
  return (
    <div className="flex h-full flex-col items-center bg-gradient-to-b from-[#1d2236] to-[#0e1018] pt-10 text-white">
      <span className="text-[12px] text-white/70">Tue, Oct 27</span>
      <span className="mt-2 text-[64px] font-light leading-none tabular-nums">{finished ? "06:12" : "01:00"}</span>
      {finished ? (
        <div className="vision-in mx-4 mt-10 rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
          <div className="text-[10.5px] text-white/60">Accelerator · Team Lead · now</div>
          <div className="mt-0.5 text-[14px] font-semibold">Good morning, Sally</div>
          <div className="text-[12.5px] text-white/80">{summary}</div>
        </div>
      ) : (
        <div className="mx-4 mt-10 rounded-2xl bg-white/10 px-4 py-3 text-[12.5px] text-white/80">Crew starting · 12 work orders · budget $40</div>
      )}
    </div>
  );
}

const PRODUCTS = [
  { name: "24V Cordless Drill", price: "$136.63", stock: true, hue: "#9fbf8f" },
  { name: "Pendant Light, Brass", price: "$146.33", stock: true, hue: "#d9b77a" },
  { name: "Wool Area Rug 5×8", price: "$219.00", stock: false, hue: "#c99c8f" },
  { name: "Impact Driver 18V", price: "$169.00", stock: true, hue: "#8fa7bf" },
];

function ShopBar() {
  return (
    <div className="flex items-center gap-2 border-b border-black/5 bg-white px-4 py-3">
      <span className="text-[14px] font-semibold">Machine Shop</span>
      <span className="ml-auto rounded-full bg-black/5 px-3 py-1 text-[11px] text-black/50">Search 10,000 products…</span>
    </div>
  );
}

function HomeScreen({ shipped }: { shipped: (n: number) => boolean }) {
  return (
    <div className="h-full">
      <ShopBar />
      {shipped(12) && <div className="vision-in bg-black/[0.03] px-4 py-1 text-[10px] text-black/40">sitemap.xml · 10,214 pages listed</div>}
      <div className="grid grid-cols-2 gap-2.5 p-3">
        {PRODUCTS.map((p, i) => (
          <div key={p.name} className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="relative h-24" style={{ background: p.hue, filter: shipped(1) ? "none" : "blur(2.5px)" }}>
              {shipped(7) && i > 1 && <span className="absolute right-1 top-1 rounded bg-white/70 px-1 text-[8.5px]">lazy</span>}
            </div>
            <div className="p-2">
              <div className="truncate text-[11.5px] font-medium">{p.name}</div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold">{p.price}</span>
                {shipped(2) && <span className={`vision-in rounded px-1 text-[9px] font-semibold ${p.stock ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{p.stock ? "In stock" : "Out"}</span>}
              </div>
              {shipped(11) && <div className="vision-in text-[8.5px] text-black/35">alt: {p.name.toLowerCase()}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="absolute bottom-0 w-full border-t border-black/5 bg-white px-4 py-2 text-center text-[10px] text-black/40">
        {shipped(6) ? "© 2026 Machine Shop · Test store: payments use Stripe test mode" : "© 2026 Machine Shop · Test store: paymnets use Stripe test mode"}
      </div>
    </div>
  );
}

function ProductScreen({ shipped }: { shipped: (n: number) => boolean }) {
  return (
    <div className="h-full">
      <ShopBar />
      <div className="mx-3 mt-3 h-40 rounded-xl" style={{ background: "#9fbf8f" }} />
      <div className="px-4 pt-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-black/40">Greenworks</div>
        <div className="text-[15px] font-semibold leading-tight">1/2 in. 24-Volt Cordless Brushless Drill/Driver</div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[20px] font-semibold">$136.63</span>
          <span className="text-[11px] font-medium text-emerald-600">In stock</span>
        </div>
        {shipped(4) && <div className="vision-in mt-1 text-[11.5px] text-black/60">+ $9.95 flat shipping · <b>$146.58</b> total</div>}
        <div className="mt-3 flex gap-2">
          <span className="rounded-full bg-[#16161a] px-4 py-2 text-[12px] font-semibold text-white">Buy now</span>
          <span className="rounded-full border border-black/15 px-3 py-2 text-[12px]">Ask about this product</span>
        </div>
        <div className="mt-3 text-[11px] text-black/45">Test store: payments use Stripe test mode. No real charges.</div>
        {shipped(9) && (
          <div className="vision-in mt-3 rounded-xl bg-[#16161a] px-3 py-2 text-[11px] text-white">
            <span className="text-white/50">Assistant · </span>It carries a 3-year tool warranty, per the catalog.
          </div>
        )}
      </div>
    </div>
  );
}

function SearchScreen() {
  return (
    <div className="h-full">
      <div className="border-b border-black/5 bg-white px-4 py-3">
        <div className="rounded-full border border-[#8b6cff]/60 px-3 py-1.5 text-[12px]">greenworks▍</div>
      </div>
      <div className="px-4 pt-3 text-[11px] text-black/45">Brand matches first · preview</div>
      <ul className="flex flex-col gap-2 p-3">
        {["Greenworks 24V Drill/Driver", "Greenworks 40V Leaf Blower", "Greenworks 24V Battery 4Ah", "Pendant Light — mentions green"].map((x, i) => (
          <li key={x} className="flex items-center gap-2 rounded-xl bg-white p-2 shadow-sm">
            <span className="size-9 rounded-lg" style={{ background: i < 3 ? "#9fbf8f" : "#d9b77a" }} />
            <span className="text-[12px]">{x}</span>
            {i < 3 && <span className="ml-auto rounded bg-[#8b6cff]/15 px-1 text-[9px] text-[#6d4fe0]">brand</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SheetScreen({ shipped }: { shipped: (n: number) => boolean }) {
  return (
    <div className="h-full bg-white p-5 font-serif">
      <div className="text-[10px] uppercase tracking-widest text-black/40">Product sheet</div>
      <div className="mt-1 text-[16px] font-semibold">24V Cordless Drill/Driver</div>
      <table className="mt-3 w-full text-[11.5px]">
        <tbody>
          {[["Chuck", "1/2 in. keyless"], ["Speed", "0–1450 RPM"], ["Torque", "310 in-lbs"], ["Weight", "5 lb"], ...(shipped(3) ? [["Warranty", "3-year tool and battery"]] : [])].map(([k, v]) => (
            <tr key={k} className={k === "Warranty" ? "vision-in bg-amber-50" : ""}>
              <td className="border-b border-black/5 py-1.5 text-black/50">{k}</td>
              <td className="border-b border-black/5 py-1.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
