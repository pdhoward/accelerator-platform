"use client";

import { useRef, useState } from "react";
import type { Change } from "@accelerator/domain";

import { cx } from "./ui";

type Folio = Change["before"];

function FolioPane({ folio, tag, fresh }: { folio: Folio; tag: string; fresh?: boolean }) {
  return (
    <div className="p-5 font-serif">
      <span className={cx("mb-2 inline-block rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]", fresh ? "bg-[#8a6d10] text-[#f7f5f0]" : "bg-[#1d1b16] text-[#f7f5f0]")}>
        {tag}
      </span>
      <h5 className="text-[15px] font-semibold">{folio.title}</h5>
      <div className="mb-2.5 font-sans text-[11.5px] text-[#7b7466]">{folio.meta}</div>
      {folio.lines.map((l) => (
        <div key={l.label} className="flex justify-between gap-3 border-b border-dotted border-[#d8d0c0] py-1 font-sans text-[12.5px]">
          <span>
            {l.label}
            {l.note && <small className="block text-[#7b7466]">{l.note}</small>}
          </span>
          <span className="tabular-nums">{l.amount}</span>
        </div>
      ))}
      <div className="flex justify-between pt-2 font-sans text-[13px] font-bold">
        <span>Total</span>
        <span className="tabular-nums">{folio.total}</span>
      </div>
    </div>
  );
}

/** Before/after with a draggable swipe, or side by side. The visual-diff heart of the Change Room. */
export function Compare({ before, after }: { before: Folio; after: Folio }) {
  const [mode, setMode] = useState<"swipe" | "side">("swipe");
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(Math.max(4, Math.min(96, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-end rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Compare mode">
        {(["swipe", "side"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cx("rounded-md px-3 py-1 text-[12.5px]", mode === m ? "bg-panel-2 text-ink ring-1 ring-line-2" : "text-fog")}
          >
            {m === "swipe" ? "Swipe" : "Side by side"}
          </button>
        ))}
      </div>
      {mode === "side" ? (
        <div className="grid overflow-hidden rounded-xl border border-line bg-[#f7f5f0] text-[#1d1b16] sm:grid-cols-2">
          <FolioPane folio={before} tag="Before" />
          <div className="border-t border-[#ddd6c8] bg-[#fbfaf6] sm:border-l sm:border-t-0">
            <FolioPane folio={after} tag="After" fresh />
          </div>
        </div>
      ) : (
        <div
          ref={ref}
          className="relative select-none overflow-hidden rounded-xl border border-line bg-[#f7f5f0] text-[#1d1b16]"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            move(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && move(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
        >
          <FolioPane folio={before} tag="Before" />
          <div className="absolute inset-0 bg-[#fbfaf6]" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            <FolioPane folio={after} tag="After" fresh />
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Compare before and after"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pos)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setPos((p) => Math.max(4, p - 5));
              if (e.key === "ArrowRight") setPos((p) => Math.min(96, p + 5));
            }}
            className="absolute inset-y-0 w-0.5 cursor-ew-resize bg-gold outline-none"
            style={{ left: `${pos}%` }}
          >
            <span className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-gold text-[13px] text-on-gold">⇆</span>
          </div>
        </div>
      )}
    </div>
  );
}
