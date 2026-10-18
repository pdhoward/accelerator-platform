"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Condition, Reading } from "@accelerator/domain";

import { cx } from "../ui";
import { angleDelta, arcPath, pointerAngle, polar, segmentAt, settle, wrap } from "./geometry";

/**
 * The Cockpit Dial (gen2-crew.md §19.5): a ring of segments, one per measure.
 * Each segment's colour is its condition, so the ring at rest is the summary;
 * turning it (drag, flick, arrows, wheel, or a tap on a segment) brings one
 * measure to the pointer at twelve o'clock and into the card.
 *
 * One angle drives everything: a small spring animates it toward the selected
 * segment (with the flick's momentum), and the ring, the upright labels and the
 * readout are all drawn from it, so they never disagree mid-turn.
 */

export const CONDITION_COLOR: Record<Condition, string> = {
  verified: "var(--color-good)",
  attention: "var(--color-warn)",
  unverified: "var(--color-mist)",
  not_connected: "url(#dial-hatch)",
};

export const CONDITION_WORD: Record<Condition, string> = {
  verified: "Verified",
  attention: "Needs a look",
  unverified: "Unverified",
  not_connected: "Not connected",
};

/** Short ring labels; the card and the readout use the full name. */
const SHORT: Record<string, string> = { integrity: "Integrity", flight: "In flight", delivery: "Delivery", census: "Census", lighthouse: "Lighthouse", lead: "Lead" };

const SIZE = 300; // room for the labels at three and nine o'clock
const C = SIZE / 2;
const R = 90;
const GAP = 3; // degrees between segments
const STIFFNESS = 190; // the spring that settles the dial: a little overshoot, then still
const DAMPING = 21;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function CockpitDial({
  readings,
  index,
  onIndex,
  label,
}: {
  readings: Reading[];
  index: number;
  onIndex: (i: number) => void;
  label: string;
}) {
  const n = readings.length;
  const step = 360 / n;
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(-index * step); // the ring's rotation, degrees
  const spring = useRef({ value: -index * step, velocity: 0, target: -index * step, raf: 0 });
  const drag = useRef<{ last: number; t: number; v: number; moved: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const animate = useCallback(() => {
    const s = spring.current;
    if (s.raf) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - last) / 1000;
      last = now;
      s.velocity += (-STIFFNESS * (s.value - s.target) - DAMPING * s.velocity) * dt;
      s.value += s.velocity * dt;
      if (Math.abs(s.value - s.target) < 0.05 && Math.abs(s.velocity) < 0.5) {
        s.value = s.target;
        s.velocity = 0;
        s.raf = 0;
        setAngle(s.value);
        return;
      }
      setAngle(s.value);
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  }, []);

  /** Turn to segment i by the shortest way round, carrying any momentum. */
  const settleOn = useCallback(
    (i: number) => {
      const s = spring.current;
      let target = -i * step;
      target += 360 * Math.round((s.value - target) / 360);
      s.target = target;
      if (reduced) {
        s.value = target;
        s.velocity = 0;
        setAngle(target);
      } else animate();
    },
    [step, reduced, animate],
  );

  useEffect(() => {
    if (!drag.current) settleOn(index);
  }, [index, settleOn]);

  // Stop the spring on unmount, and clear its frame id so a remount (React Strict Mode) can start it again.
  useEffect(
    () => () => {
      const s = spring.current;
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    },
    [],
  );

  // The wheel turns one segment at a time (only while the pointer is over the dial).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - last < 140 || Math.abs(e.deltaY) < 4) return;
      last = now;
      onIndex(wrap(index + (e.deltaY > 0 ? 1 : -1), n));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [index, n, onIndex]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = spring.current;
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.velocity = 0;
    drag.current = { last: pointerAngle(e, e.currentTarget.getBoundingClientRect()), t: performance.now(), v: 0, moved: 0 };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const a = pointerAngle(e, e.currentTarget.getBoundingClientRect());
    const delta = angleDelta(d.last, a);
    const now = performance.now();
    d.v = 0.6 * d.v + 0.4 * (delta / Math.max(1, now - d.t)); // smoothed degrees per ms, for the flick
    d.t = now;
    d.last = a;
    d.moved += Math.abs(delta);
    const s = spring.current;
    s.value += delta;
    setAngle(s.value);
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const s = spring.current;
    if (d.moved < 4) {
      // A tap: jump to the segment under the pointer.
      const i = segmentAt(pointerAngle(e, e.currentTarget.getBoundingClientRect()), s.value, n);
      onIndex(i);
      settleOn(i);
      return;
    }
    // A flick coasts: the release velocity carries into the spring, which settles on the segment it was heading for.
    // Released after holding still: no flick.
    const flick = reduced || performance.now() - d.t > 80 ? 0 : d.v;
    s.velocity = flick * 1000 * 0.5;
    const i = settle(s.value + flick * 220, n);
    onIndex(i);
    settleOn(i);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? index + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? index - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (next == null) return;
    e.preventDefault();
    onIndex(wrap(next, n));
  }

  // While dragging, the readout previews the segment under the pointer.
  const live = dragging ? settle(angle, n) : index;
  const shown = readings[live]!;
  const current = readings[index]!;
  const valueText = `${current.label}: ${current.headline ? `${current.headline} ${current.unit}`.trim() : current.state}, ${CONDITION_WORD[current.condition].toLowerCase()}`;

  return (
    <div
      ref={host}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={index + 1}
      aria-valuetext={valueText}
      data-angle={Math.round(angle)}
      onKeyDown={onKeyDown}
      className="relative mx-auto aspect-square w-full max-w-[320px] select-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-gold/50 focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className={cx("size-full touch-none", dragging ? "cursor-grabbing" : "cursor-grab")}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id="dial-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--color-panel-2)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--color-line-2)" strokeWidth="2.2" />
          </pattern>
          <radialGradient id="dial-face" cx="50%" cy="36%" r="64%">
            <stop offset="0%" stopColor="var(--color-panel-2)" />
            <stop offset="100%" stopColor="var(--color-bg)" />
          </radialGradient>
        </defs>

        {/* The face and a fine tick bezel, fixed. */}
        <circle cx={C} cy={C} r={R - 14} fill="url(#dial-face)" stroke="var(--color-line)" />
        {Array.from({ length: 60 }, (_, k) => {
          const a = polar(C, R + 12, k * 6);
          const b = polar(C, R + (k % 5 ? 14.5 : 16.5), k * 6);
          return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-line-2)" strokeWidth={k % 5 ? 0.6 : 1} />;
        })}

        {/* The ring: each segment drawn at its current angle, coloured by its condition. */}
        {readings.map((r, i) => {
          const mid = i * step + angle;
          const selected = i === live;
          const at = polar(C, R + 28, mid);
          const text = SHORT[r.id] ?? r.label;
          return (
            <g key={r.id}>
              <path
                d={arcPath(C, R, mid - step / 2 + GAP / 2, mid + step / 2 - GAP / 2)}
                fill="none"
                stroke={CONDITION_COLOR[r.condition]}
                strokeWidth={selected ? 19 : 13}
                opacity={selected ? 1 : r.condition === "not_connected" ? 0.85 : 0.48}
                style={{ transition: reduced ? "none" : "stroke-width 260ms ease, opacity 260ms ease" }}
              />
              <text
                x={at.x}
                y={at.y}
                textAnchor="middle"
                dominantBaseline="central"
                className={cx("font-mono uppercase", selected ? "fill-ink" : "fill-mist")}
                style={{ fontSize: 7.2, letterSpacing: "0.08em", fontWeight: selected ? 600 : 400 }}
              >
                {text}
              </text>
            </g>
          );
        })}

        {/* The pointer. */}
        <path d={`M ${C - 6.5} ${C - R - 22} L ${C + 6.5} ${C - R - 22} L ${C} ${C - R - 12} Z`} fill="var(--color-gold-2)" />
      </svg>

      {/* The centre readout: the measure under the pointer, rolling in when it changes. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div key={`${shown.id}:${shown.headline}`} className="flex flex-col items-center motion-safe:animate-[dial-roll_380ms_cubic-bezier(0.2,0.9,0.3,1)]">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist">{shown.label}</span>
          <span className={cx("mt-1 font-semibold tabular-nums leading-none tracking-tight", shown.headline && shown.headline.length > 5 ? "text-3xl" : "text-[44px]")}>
            {shown.headline ?? "—"}
          </span>
          <span className="mt-1.5 max-w-[140px] text-[11px] leading-tight text-fog">{shown.headline ? shown.unit : ""}</span>
          <span
            className="mt-2 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{
              color: shown.condition === "not_connected" ? "var(--color-mist)" : CONDITION_COLOR[shown.condition],
              background: "color-mix(in oklab, currentColor 14%, transparent)",
            }}
          >
            {shown.state}
          </span>
        </div>
      </div>
    </div>
  );
}
