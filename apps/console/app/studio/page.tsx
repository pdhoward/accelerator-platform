"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * /studio — a prototype for reflection, not a product screen.
 *
 * A re-staging of the "RE Studio" video (a nebula of tools being wired in six
 * steps, with a run log, groups, a matrix, a stream and a curve) in the
 * Cradle's world: Machine Shop's policy book being bound, step by step, from
 * the first real ingest (2026-10-30: 22 policies, 3 contradictions). The
 * citation counts are the ingest's own. Everything else is a scripted animation.
 */

// ── The book: Machine Shop's 22 policies, as the real ingest found them ─────
type Kind = "pack" | "override" | "site";
type Pol = { key: string; title: string; role: string; cites: number; group: number; step: number; kind: Kind; at: [number, number] };

const GROUPS = [
  { name: "checkout + payment", tag: "Stripe · catalog price · test mode" },
  { name: "catalog + price", tag: "dollars · stock · read-only catalog" },
  { name: "shipping + orders", tag: "flat $9.95 · US only · order page" },
  { name: "assistant + voice", tag: "typed · voice · limits · lockout" },
  { name: "customer data", tag: "minimise · HMAC · 30-day transcripts" },
];

const BOOK: Pol[] = [
  { key: "C-CHK-1", title: "Stripe Checkout", role: "pays · pack", cites: 3, group: 0, step: 1, kind: "pack", at: [0.36, 0.52] },
  { key: "C-CHK-2", title: "Catalog sets price", role: "start · pack", cites: 4, group: 0, step: 2, kind: "pack", at: [0.3, 0.42] },
  { key: "C-CHK-3", title: "Failed pay, no order", role: "fail · pack", cites: 3, group: 0, step: 2, kind: "pack", at: [0.41, 0.33] },
  { key: "C-PRICE-1", title: "Dollars and cents", role: "display · pack", cites: 3, group: 1, step: 2, kind: "pack", at: [0.22, 0.6] },
  { key: "C-INV-1", title: "No sale out of stock", role: "oversell · pack", cites: 4, group: 1, step: 2, kind: "pack", at: [0.47, 0.62] },
  { key: "C-ORD-1", title: "Order after payment", role: "create · pack", cites: 2, group: 2, step: 2, kind: "pack", at: [0.27, 0.74] },
  { key: "C-AST-1", title: "Answers from catalog", role: "answer · pack", cites: 3, group: 3, step: 3, kind: "pack", at: [0.55, 0.28] },
  { key: "C-DATA-1", title: "Collect only needed", role: "collect · pack", cites: 2, group: 4, step: 3, kind: "pack", at: [0.62, 0.47] },
  { key: "S-ASSIST-2", title: "Assistant limits", role: "6 turns · 30/10 min", cites: 3, group: 3, step: 3, kind: "site", at: [0.5, 0.18] },
  { key: "S-ASSIST-3", title: "Calls max 5 min", role: "voice · site", cites: 3, group: 3, step: 3, kind: "site", at: [0.66, 0.34] },
  { key: "S-CHECKO-1", title: "Test mode only", role: "critical · site", cites: 4, group: 0, step: 4, kind: "site", at: [0.39, 0.45] },
  { key: "S-CHECKO-2", title: "One per order", role: "qty 1 · site", cites: 2, group: 0, step: 4, kind: "site", at: [0.24, 0.32] },
  { key: "S-CHECKO-3", title: "USD, priced only", role: "currency · site", cites: 2, group: 0, step: 4, kind: "site", at: [0.33, 0.22] },
  { key: "S-CHECKO-4", title: "Whole cents", role: "half-up · site", cites: 1, group: 0, step: 4, kind: "site", at: [0.45, 0.52] },
  { key: "S-PRODUC-1", title: "Never edits catalog", role: "read-only · site", cites: 1, group: 1, step: 4, kind: "site", at: [0.17, 0.48] },
  { key: "C-SHIP-1", title: "Flat shipping $9.95", role: "override · pack $7.95", cites: 2, group: 2, step: 5, kind: "override", at: [0.33, 0.83] },
  { key: "S-SHIPPI-1", title: "US addresses only", role: "ship · site", cites: 2, group: 2, step: 5, kind: "site", at: [0.43, 0.76] },
  { key: "S-CUSTOM-1", title: "IDs as HMACs", role: "privacy · site", cites: 1, group: 4, step: 5, kind: "site", at: [0.68, 0.6] },
  { key: "S-CUSTOM-2", title: "Transcripts 30 days", role: "delete · site", cites: 3, group: 4, step: 5, kind: "site", at: [0.58, 0.7] },
  { key: "S-OTHER-1", title: "Lockout after 5", role: "access · site", cites: 2, group: 3, step: 5, kind: "site", at: [0.71, 0.22] },
  { key: "S-ASSIST-1", title: "Says no orders", role: "conflict · Buy now", cites: 2, group: 3, step: 6, kind: "site", at: [0.6, 0.15] },
  { key: "S-ORDER-1", title: "Order page", role: "conflict · test mode", cites: 4, group: 2, step: 6, kind: "site", at: [0.2, 0.84] },
];
/** Both sides of the three contradictions the ingest found. */
const CONFLICT_KEYS = new Set(["S-ASSIST-1", "C-CHK-1", "S-ORDER-1", "S-CHECKO-1", "C-INV-1", "S-CHECKO-3"]);
const TOTAL_CITES = BOOK.reduce((n, p) => n + p.cites, 0);
const PACK = BOOK.filter((p) => p.kind !== "site").length;

const STEPS = [
  { title: "INGEST", sub: "Team Lead · Surveyor · Extractor", log: [["01 INGEST", "machine-shop · read-only"], ["01 PACK", "commerce 0.1.0 · 17 starter"], ["01 HOST", "runner · Claude · 130s"]] },
  { title: "MATCH", sub: "pack · commerce 0.1.0", log: [["02 MATCH", "checkout · price · stock · order"]] },
  { title: "ASSISTANT", sub: "typed · voice · data", log: [["03 ASSIST", "catalog answers · limits · 5 min"]] },
  { title: "SITE", sub: "the shop's own rules", log: [["04 SITE", "test mode · qty 1 · USD · cents"]] },
  { title: "OVERRIDE", sub: "shipping · privacy · access", log: [["05 OVERRIDE", "shipping $9.95 · pack $7.95"]] },
  { title: "BOOK", sub: "3 contradictions · your walk", log: [] as string[][] },
];
const END_LOG: [string, string, boolean?][] = [
  ["06 CONFLICT", "assistant: no orders × Buy now", true],
  ["06 CONFLICT", "order page ships × test mode", true],
  ["06 CONFLICT", "stock default × 2021 data", true],
  ["◆ BOUND", "22 policies · 5 groups"],
  ["◆ WALK", "3 rulings · your turn"],
];

const STEP_MS = 4200;
const HOLD_MS = 6000;
const LENGTH = STEP_MS * 6 + HOLD_MS;
const wiredAt = (p: Pol) => {
  const inStep = BOOK.filter((x) => x.step === p.step);
  return (p.step - 1) * STEP_MS + 700 + inStep.indexOf(p) * Math.min(600, (STEP_MS - 1200) / inStep.length);
};

const C = { bg: "#0d0806", line: "#3a2620", dim: "#5c4238", fog: "#b59a8c", ink: "#f4e6dc", orange: "#f2a03a", gold: "#e8b04a", salmon: "#ec7a5c", red: "#e5484d", pink: "#ff6fa0" };
const k = (n: number) => String(n);

// ── The page ────────────────────────────────────────────────────────────────
export default function StudioPage() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      if (last.current != null) setT((x) => (x + (now - last.current!) * speed) % LENGTH);
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed]);

  const step = Math.min(6, Math.floor(t / STEP_MS) + 1);
  const settled = t >= STEP_MS * 5 + 1800;
  const wired = useMemo(() => BOOK.filter((p) => wiredAt(p) <= t), [t]);
  const latest = wired.at(-1) ?? null;
  const cites = wired.reduce((n, p) => n + p.cites, 0);
  const kernels = Math.min(6, Math.round((wired.length / BOOK.length) * 6));
  const conflicts = t >= STEP_MS * 5 + 900 ? Math.min(3, Math.floor((t - STEP_MS * 5 - 900) / 500) + 1) : 0;

  const log = useMemo(() => {
    const out: { a: string; b: string; hot: boolean; red?: boolean }[] = [];
    STEPS.forEach((s, i) => {
      if (t >= i * STEP_MS) s.log.forEach(([a, b]) => out.push({ a: a!, b: b!, hot: i + 1 === step }));
      BOOK.filter((p) => p.step === i + 1 && i > 0 && wiredAt(p) <= t && i < 5).forEach((p) => out.push({ a: `0${i + 1} ${p.kind === "override" ? "OVERRIDE" : p.kind === "site" ? "SITE" : "MATCH"}`, b: `${p.key} · ${p.title}`, hot: i + 1 === step }));
    });
    END_LOG.forEach((l, i) => t >= STEP_MS * 5 + 900 + i * 500 && out.push({ a: l[0], b: l[1], hot: true, red: l[2] }));
    return out;
  }, [t, step]);

  return (
    <div className="min-h-screen px-3 py-3 font-mono text-[12px] sm:px-5" style={{ background: C.bg, color: C.ink }}>
      <style>{`
        .st-in { animation: st-in .35s ease-out both } @keyframes st-in { from { opacity: 0; transform: translateY(3px) } to { opacity: 1; transform: none } }
        .st-blink { animation: st-blink 1s steps(2) infinite } @keyframes st-blink { 50% { opacity: 0 } }
        .st-spin { animation: st-spin 6s linear infinite; transform-origin: center } @keyframes st-spin { to { transform: rotate(360deg) } }
      `}</style>
      <div className="mx-auto max-w-[1200px]">
        {/* Header */}
        <header className="flex flex-wrap items-end gap-x-8 gap-y-2 border-b pb-2" style={{ borderColor: C.line }}>
          <div>
            <div className="text-[22px] font-bold tracking-wide">CRADLE · POLICY STUDIO</div>
            <div style={{ color: C.orange }}>one cradle · 22 policies · 5 groups</div>
          </div>
          <div className="ml-auto flex items-end gap-8">
            <Head label="STATE" value={settled ? "settled" : "wiring"} />
            <Head label="STEP" value={`${step}/6`} white />
            <div className="hidden gap-1 sm:flex">{[1, 2, 3, 4, 5, 6].map((s) => <span key={s} className="h-1.5 w-6" style={{ background: s <= step ? C.gold : C.line }} />)}</div>
            <div className="flex items-center gap-1 rounded border px-1" style={{ borderColor: C.line }}>
              <button type="button" className="px-1.5 py-0.5 hover:text-white" style={{ color: C.fog }} onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</button>
              <button type="button" className="px-1.5 py-0.5 hover:text-white" style={{ color: C.fog }} onClick={() => { setT(0); setPlaying(true); }}>replay</button>
              {[1, 2].map((s) => <button key={s} type="button" onClick={() => setSpeed(s)} className="px-1.5 py-0.5" style={{ color: speed === s ? C.orange : C.dim }}>{s}×</button>)}
            </div>
          </div>
        </header>
        <div className="h-px" style={{ background: `linear-gradient(90deg, ${C.orange} ${(t / (STEP_MS * 6)) * 100}%, transparent 0)` }} />
        <div className="grid grid-cols-4 border-b py-1.5 sm:grid-cols-7" style={{ borderColor: C.line }}>
          {[["PACK", "1"], ["POLICIES", "22"], ["KERNELS", k(kernels) + "/6"], ["GROUPS", "5"], ["CITES ★", k(cites)], ["CONFLICTS", k(conflicts)], ["BOUND", `${wired.length}/22`]].map(([a, b], i) => (
            <div key={a} className="px-1">
              <div className="text-[10.5px]" style={{ color: C.fog }}>{a}</div>
              <div className="text-[14px]" style={{ color: i >= 4 ? C.salmon : C.ink }}>{b}</div>
            </div>
          ))}
        </div>

        {/* Hero */}
        <Hero t={t} step={step} settled={settled} wired={wired} latest={latest} />

        {/* Panels */}
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <Panel n="01" title="POLICIES" right="1 cradle">
            <div className="flex items-center gap-5">
              <span className="text-[72px] font-bold leading-none">22</span>
              <div>
                <div className="text-[16px] font-bold">POLICIES</div>
                <div className="text-[15px]" style={{ color: C.salmon }}>PACK {PACK} + {22 - PACK}</div>
                <div style={{ color: C.fog }}>5 groups · 1 cradle</div>
              </div>
            </div>
            <div className="mt-3" style={{ color: wired.length ? C.orange : C.fog }}>bound {wired.length}/22 · kernels {kernels}/6</div>
            <div className="mt-2 flex h-[78px] items-end gap-[3px]">
              {BOOK.map((p) => {
                const on = wired.includes(p);
                return <span key={p.key} className="flex-1 transition-colors duration-500" style={{ height: `${25 + p.cites * 17}%`, background: on ? (p.step === step && !settled ? C.orange : C.salmon) : "#2a1b16" }} />;
              })}
            </div>
            <div className="mt-1" style={{ color: C.fog }}>★ cites per policy · log</div>
          </Panel>

          <Panel n="02" title="RUN" right={`step ${step}/6`}>
            <div className="border-b pb-1 text-[13px]" style={{ borderColor: C.line, color: C.orange }}>~/cradle $ cradle walk --watch<span className="st-blink">▊</span></div>
            <div className="mt-1 flex h-[156px] flex-col justify-end overflow-hidden">
              <div>
                {log.slice(-11).map((l, i) => (
                  <div key={`${l.a}${l.b}${i}`} className="st-in flex gap-3 leading-[1.45]">
                    <span className="w-[92px] shrink-0" style={{ color: l.red ? C.pink : l.a.startsWith("◆") ? C.gold : l.hot ? C.orange : C.ink }}>{l.a}</span>
                    <span className="truncate" style={{ color: l.red ? C.pink : l.hot ? C.orange : C.ink }}>{l.b}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel n="03" title="GROUPS" right="5 · 22 policies">
            {GROUPS.map((g, gi) => {
              const all = BOOK.filter((p) => p.group === gi);
              const on = all.filter((p) => wired.includes(p));
              const hot = latest?.group === gi && !settled;
              return (
                <div key={g.name} className="mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-[140px] truncate font-bold" style={{ color: hot ? C.orange : C.ink }}>{g.name}</span>
                    <span className="h-1.5 flex-1" style={{ background: "#2a1b16" }}><span className="block h-full transition-all duration-500" style={{ width: `${(on.length / all.length) * 100}%`, background: C.gold }} /></span>
                    <span className="w-8 text-right">{on.length}/{all.length}</span>
                    <span className="w-12 text-right" style={{ color: C.salmon }}>{all.reduce((n, p) => n + p.cites, 0)}★</span>
                  </div>
                  <div className="truncate" style={{ color: C.fog }}>{g.tag}</div>
                </div>
              );
            })}
            <div className="mt-1 border-t pt-1" style={{ borderColor: C.line }}>Σ ★ {TOTAL_CITES} · site's own {Math.round(((22 - PACK) / 22) * 100)}%</div>
          </Panel>

          <Panel n="04" title="MATRIX" right="22 × 6">
            <div className="grid gap-[3px]" style={{ gridTemplateColumns: "12px repeat(22, 1fr)" }}>
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <Row key={s} s={s} step={step} wired={wired} />
              ))}
            </div>
            <div className="mt-1" style={{ color: C.fog }}>policy × step · bound cells</div>
            <div className="mt-2 flex items-center gap-3">
              <Sphere t={t} />
              <div>
                <div style={{ color: C.fog }}>SITE/PACK</div>
                <div className="text-[34px] font-bold leading-none" style={{ color: C.salmon }}>{((22 - PACK) / PACK).toFixed(1)}×</div>
                <div className="mt-1">site's own {22 - PACK}</div>
                <div>from the pack {PACK}</div>
                <div style={{ color: C.gold }}>commerce 0.1.0</div>
              </div>
            </div>
          </Panel>

          <Panel n="05" title="STREAM" right="live">
            <div className="flex border-b pb-1" style={{ borderColor: C.line, color: C.fog }}><span className="w-[46%]">policy</span><span className="flex-1">role</span><span>★</span></div>
            <div className="h-[218px] overflow-hidden">
              {wired.slice(-10).map((p) => (
                <div key={p.key} className="st-in flex items-center py-[2px]" style={{ background: p === latest && !settled ? "#2a1610" : undefined }}>
                  <span className="mr-2 h-2 w-2 shrink-0" style={{ background: p.role.startsWith("conflict") ? C.pink : C.salmon }} />
                  <span className="w-[42%] truncate font-bold" style={{ color: p === latest && !settled ? C.orange : C.ink }}>{p.title}</span>
                  <span className="flex-1 truncate" style={{ color: p.role.startsWith("conflict") ? C.pink : C.fog }}>{p.role}</span>
                  <span style={{ color: C.salmon }}>{p.cites}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel n="06" title="Σ ★ CURVE" right="bound 1 → 22">
            <Curve wired={wired} cites={cites} />
          </Panel>
        </div>
        <p className="mt-3 text-center text-[10.5px]" style={{ color: C.dim }}>
          A scripted simulation for reflection: Machine Shop's policy book from its first real ingest, staged after the RE Studio video. ★ = code citations the crew found for each policy.
        </p>
      </div>
    </div>
  );
}

function Head({ label, value, white }: { label: string; value: string; white?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px]" style={{ color: C.fog }}>{label}</div>
      <div className="text-[15px] font-bold" style={{ color: white ? C.ink : C.orange }}>{value}</div>
    </div>
  );
}

function Panel({ n, title, right, children }: { n: string; title: string; right: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 border p-3" style={{ borderColor: C.line, background: "#120b08" }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2" style={{ background: C.orange }} />
        <span className="font-bold">{n} · {title}</span>
        <span className="ml-auto" style={{ color: right === "live" ? C.orange : C.salmon }}>{right}</span>
      </div>
      {children}
    </section>
  );
}

function Row({ s, step, wired }: { s: number; step: number; wired: Pol[] }) {
  return (
    <>
      <span className="text-[10px] leading-[10px]" style={{ color: s === step ? C.orange : C.fog }}>{s}</span>
      {BOOK.map((p) => {
        const on = p.step === s && wired.includes(p);
        return <span key={p.key} className="h-[10px] transition-colors duration-300" style={{ background: on ? (s === step ? C.orange : C.gold) : s === step ? "#2c1d16" : "#1d130f" }} />;
      })}
    </>
  );
}

function Sphere({ t }: { t: number }) {
  const dots = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ a: (i * 137.5 * Math.PI) / 180, r: Math.sqrt(i / 70) * 44 })), []);
  const spin = t / 4000;
  return (
    <svg viewBox="-50 -50 100 100" width={110} height={110} aria-hidden>
      {dots.map((d, i) => <circle key={i} cx={Math.cos(d.a + spin) * d.r} cy={Math.sin(d.a + spin) * d.r * 0.92} r={0.9} fill={i % 9 === 0 ? C.salmon : C.dim} />)}
      {[["code", -30, -28], ["pages", 18, 2], ["tests", -24, 30]].map(([l, x, y]) => (
        <g key={l as string}>
          <circle cx={x as number} cy={y as number} r={2.2} fill={C.pink} />
          <text x={(x as number) + 4} y={(y as number) - 3} fontSize="8" fill={C.fog}>{l}</text>
        </g>
      ))}
    </svg>
  );
}

function Curve({ wired, cites }: { wired: Pol[]; cites: number }) {
  const W = 300, H = 170, max = TOTAL_CITES + 4;
  let run = 0;
  const pts = wired.map((p, i) => {
    run += p.cites;
    return [16 + (i / 21) * (W - 26), H - 18 - (run / max) * (H - 30)] as const;
  });
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <div>
      <div className="text-right">
        <div className="text-[22px] font-bold" style={{ color: C.salmon }}>{cites} ★</div>
        <div style={{ color: C.fog }}>site's own share {wired.length ? Math.round((wired.filter((p) => p.kind === "site").length / wired.length) * 100) : 0}%</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" aria-hidden>
        {[0.33, 0.66, 1].map((f) => (
          <g key={f}>
            <line x1={16} x2={W} y1={H - 18 - f * (H - 30)} y2={H - 18 - f * (H - 30)} stroke="#2a1b16" />
            <text x={0} y={H - 15 - f * (H - 30)} fontSize="9" fill={C.fog}>{Math.round(f * max)}</text>
          </g>
        ))}
        {pts.length > 0 && <path d={`${path} L${pts.at(-1)![0]},${H - 18} L16,${H - 18} Z`} fill="#e5484d22" />}
        <path d={path} fill="none" stroke={C.salmon} strokeWidth={1.6} />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3 : 1.4} fill={i === pts.length - 1 ? C.orange : C.salmon} />)}
        {pts[0] && <text x={pts[0][0] + 2} y={pts[0][1] - 5} fontSize="9" fill={C.salmon}>CHK</text>}
        <text x={16} y={H - 2} fontSize="9" fill={C.fog}>1</text>
        <text x={W / 2 - 30} y={H - 2} fontSize="9" fill={C.fog}>policies bound</text>
        <text x={W - 12} y={H - 2} fontSize="9" fill={C.fog}>22</text>
      </svg>
    </div>
  );
}

// ── The hero: the nebula, the policies wired into it, the arc and the ring ──
function Hero({ t, step, settled, wired, latest }: { t: number; step: number; settled: boolean; wired: Pol[]; latest: Pol | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shrink = useRef(1);
  const tRef = useRef(t);
  tRef.current = t;
  const settledRef = useRef(settled);
  settledRef.current = settled;

  // A seeded cloud: a few gaussian blobs of embers, drawn additively.
  const parts = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;
    const blobs: [number, number, number, number][] = [[0.35, 0.5, 0.11, 0.42], [0.3, 0.32, 0.08, 0.16], [0.47, 0.66, 0.07, 0.14], [0.55, 0.3, 0.06, 0.1], [0.25, 0.72, 0.07, 0.1], [0.42, 0.42, 0.18, 0.08]];
    const out: { x: number; y: number; s: number; a: number; w: number }[] = [];
    for (const [cx, cy, sd, share] of blobs) for (let i = 0; i < 16000 * share; i++) out.push({ x: cx + g() * sd * 1.6, y: cy + g() * sd * 1.9, s: rnd() < 0.05 ? 2.4 : 1.4, a: 0.3 + rnd() * 0.6, w: rnd() });
    for (let i = 0; i < 260; i++) out.push({ x: rnd(), y: rnd(), s: 1, a: 0.08 + rnd() * 0.15, w: rnd() });
    return out;
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = el.clientWidth, H = el.clientHeight;
      if (el.width !== W * dpr) { el.width = W * dpr; el.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);
      shrink.current += ((settledRef.current ? 0.42 : 1) - shrink.current) * 0.05;
      const sc = shrink.current;
      const ox = settledRef.current ? W * 0.5 - W * 0.4 * sc : (1 - sc) * W * 0.4;
      const oy = (1 - sc) * H * 0.5;
      const breathe = Math.sin(tRef.current / 1400) * 0.004;
      // Glow under the cloud.
      const glow = ctx.createRadialGradient(ox + W * 0.3 * sc, oy + H * 0.5 * sc, 4, ox + W * 0.3 * sc, oy + H * 0.5 * sc, W * 0.34 * sc);
      glow.addColorStop(0, "rgba(255,140,90,0.75)");
      glow.addColorStop(0.45, "rgba(200,40,30,0.35)");
      glow.addColorStop(1, "rgba(120,20,10,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (const p of parts) {
        const tw = 0.6 + 0.4 * Math.sin(tRef.current / 600 + p.w * 40);
        ctx.fillStyle = p.w > 0.85 ? `rgba(255,214,150,${p.a * tw})` : p.w > 0.4 ? `rgba(255,96,64,${p.a * tw})` : `rgba(190,40,40,${p.a * tw})`;
        ctx.fillRect(ox + (p.x + breathe) * W * 0.8 * sc, oy + p.y * H * sc, p.s, p.s);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [parts]);

  const S = STEPS[step - 1]!;
  const fresh = wired.filter((p) => p.step === step);
  const done = wired.length / BOOK.length;
  const bars = useMemo(() => Array.from({ length: 140 }, (_, i) => 0.35 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.65), []);

  return (
    <div className="relative mt-2 h-[560px] overflow-hidden border" style={{ borderColor: C.line }}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      {/* Corner ticks */}
      {["left-3 top-3 border-l border-t", "right-3 top-3 border-r border-t", "left-3 bottom-3 border-l border-b", "right-3 bottom-3 border-r border-b"].map((c) => <span key={c} className={`absolute h-4 w-4 ${c}`} style={{ borderColor: C.dim }} />)}

      <div className="absolute left-4 top-3 z-10 border-l-2 pl-3" style={{ borderColor: C.orange }}>
        <div key={step} className="st-in text-[22px] font-bold">0{step} · {S.title}</div>
        <div style={{ color: C.orange }}>{S.sub}</div>
      </div>

      <svg viewBox="0 0 1000 560" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
        {!settled ? (
          <g>
            {/* The arc on the right, with radial bars that light as policies bind. */}
            <path d="M 690 -20 A 620 620 0 0 1 690 580" fill="none" stroke={C.dim} strokeWidth="1.2" />
            <path d="M 712 -20 A 640 640 0 0 1 712 580" fill="none" stroke={C.orange} strokeOpacity="0.5" strokeWidth="2" />
            {bars.map((b, i) => {
              const a = -0.62 + (i / bars.length) * 1.24;
              const r0 = 650, r1 = r0 + 20 + b * 170;
              const cx = 70, cy = 280;
              const lit = i / bars.length < done;
              return <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1} stroke={lit ? C.orange : "#3b2a22"} strokeOpacity={lit ? 0.85 : 0.6} strokeWidth="1.4" />;
            })}
          </g>
        ) : (
          <g className="st-in">
            {/* The settled ring: one segment per policy, the conflicts in pink. */}
            <circle cx="500" cy="280" r="190" fill="none" stroke={C.dim} strokeWidth="1.5" />
            <circle cx="500" cy="280" r="178" fill="none" stroke="#2a1b16" strokeWidth="1" />
            {BOOK.map((p, i) => {
              const a0 = (i / 22) * Math.PI * 2 - Math.PI / 2 + 0.02, a1 = ((i + 1) / 22) * Math.PI * 2 - Math.PI / 2 - 0.02;
              const lines = [];
              const conflict = CONFLICT_KEYS.has(p.key);
              for (let j = 0; j < 16; j++) {
                const a = a0 + ((a1 - a0) * j) / 15;
                const r1 = 205 + 30 + p.cites * 14;
                lines.push(<line key={j} x1={500 + Math.cos(a) * 205} y1={280 + Math.sin(a) * 205} x2={500 + Math.cos(a) * r1} y2={280 + Math.sin(a) * r1} stroke={conflict ? C.pink : "#c9b2a6"} strokeOpacity={conflict ? 0.75 : 0.35} strokeWidth="1" />);
              }
              return <g key={p.key}>{lines}{conflict && <path d={`M ${500 + Math.cos(a0) * 198} ${280 + Math.sin(a0) * 198} A 198 198 0 0 1 ${500 + Math.cos(a1) * 198} ${280 + Math.sin(a1) * 198}`} stroke={C.pink} strokeWidth="3" fill="none" />}</g>;
            })}
          </g>
        )}
        {/* Numbered step markers. */}
        {[1, 2, 3, 4, 5, 6].map((s, i) => {
          const x = settled ? 548 + i * 18 : 470 + i * 46, y = settled ? 200 - i * 12 : 160 - Math.sin((i / 5) * 1.2) * 110;
          return (
            <g key={s}>
              <circle cx={x} cy={y} r={s === step ? 9 : 6} fill={s < step ? "#1a0f0b" : "none"} stroke={s <= step ? C.gold : C.fog} strokeWidth="1.5" />
              {s <= step && <circle cx={x} cy={y} r="3" fill={C.gold} />}
              {!settled && <text x={x - 3} y={y - 13} fontSize="11" fill={s <= step ? C.gold : C.fog}>{s}</text>}
            </g>
          );
        })}
      </svg>

      {/* Policies in the cloud: the step's pills, and the reticle on the latest. */}
      {!settled && fresh.map((p) => (
        <div key={p.key} className="st-in absolute z-10 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold" style={{ left: `${p.at[0] * 80}%`, top: `${p.at[1] * 100}%`, borderColor: C.dim, background: "#1a0f0bdd" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.kind === "override" ? C.gold : p.kind === "site" ? C.pink : C.salmon }} />
          {p.title}
        </div>
      ))}
      {!settled && latest && latest.step === step && (
        <>
          <svg className="st-spin pointer-events-none absolute z-10" width="70" height="70" viewBox="-35 -35 70 70" style={{ left: `calc(${latest.at[0] * 80}% - 35px)`, top: `calc(${latest.at[1] * 100}% - 35px)` }} aria-hidden>
            <circle r="30" fill="none" stroke={C.orange} strokeDasharray="14 8" />
            <circle r="18" fill="none" stroke={C.orange} strokeOpacity="0.7" />
            <circle r="4" fill={C.orange} />
          </svg>
          <div key={latest.key} className="st-in absolute z-20 w-[210px] border px-2.5 py-1.5" style={{ left: `calc(${latest.at[0] * 80}% + 40px)`, top: `calc(${latest.at[1] * 100}% + 8px)`, borderColor: C.orange, background: "#160d09ee" }}>
            <div className="flex font-bold"><span>{latest.key}</span><span className="ml-auto" style={{ color: C.salmon }}>{latest.cites} ★</span></div>
            <div style={{ color: C.orange }}>{latest.title}</div>
            <div style={{ color: C.fog }}>{latest.role} · G{latest.group + 1}</div>
          </div>
        </>
      )}
      {/* Labels down the arc. */}
      {!settled && (
        <div className="absolute right-[31%] top-[24%] z-10 hidden flex-col gap-[30px] text-right md:flex">
          {wired.slice(-6).map((p) => (
            <div key={p.key} className="st-in leading-tight">
              <div style={{ color: p.step === step ? C.orange : C.fog }}>{p.title}</div>
              <div style={{ color: C.salmon }}>{p.cites} ★</div>
            </div>
          ))}
        </div>
      )}
      {settled && (
        <>
          <div className="st-in absolute bottom-12 left-6 z-10">
            <div style={{ color: C.fog }}>policies bound</div>
            <div className="text-[54px] font-bold leading-none">22</div>
            <div className="mt-3" style={{ color: C.fog }}>contradictions for you</div>
            <div className="text-[54px] font-bold leading-none" style={{ color: C.salmon }}>3</div>
          </div>
          {[["Says no orders", "34%", "13%", true], ["Stripe Checkout", "70%", "22%", true], ["Order page", "24%", "82%", true], ["Shipping $9.95", "71%", "76%", false]].map(([l, x, y, pink]) => (
            <div key={l as string} className="st-in absolute z-10 font-bold" style={{ left: x as string, top: y as string, color: pink ? C.pink : C.gold }}>{l as string}</div>
          ))}
        </>
      )}
      <div className="absolute bottom-3 left-6 z-10" style={{ color: C.fog }}>★ log · 22 policies · 6 steps</div>
    </div>
  );
}
