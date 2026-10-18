"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, Check, CircleDot, Hand, X } from "lucide-react";
import { COMPLEXITY_LABEL, type ArtifactCard, type Complexity, type Milestone, type MilestoneState } from "@accelerator/domain";

import { Card, Chip, cx, Eyebrow } from "../ui";

/**
 * The Work item cockpit's side bar (gen2-crew.md §19, F3d): where the work is,
 * sized to its tier, and its documents as one-glance cards that open the full
 * text in a drawer.
 */

const STATE: Record<MilestoneState, { icon: ReactNode; ring: string; word: string }> = {
  done: { icon: <Check className="size-3.5" />, ring: "border-good/50 bg-good/15 text-good", word: "done" },
  current: { icon: <CircleDot className="size-3.5 motion-safe:animate-pulse" />, ring: "border-violet/60 bg-violet/15 text-violet", word: "in progress" },
  waiting: { icon: <Hand className="size-3.5" />, ring: "border-gold/60 bg-gold/15 text-gold-2", word: "waiting on you" },
  blocked: { icon: <AlertTriangle className="size-3.5" />, ring: "border-warn/60 bg-warn/15 text-warn", word: "needs a look" },
  todo: { icon: null, ring: "border-line-2 text-mist", word: "to come" },
};

export function WhereWeAre({ milestones, complexity }: { milestones: Milestone[]; complexity: Complexity }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Where we are</h2>
        <Chip tone="violet">{COMPLEXITY_LABEL[complexity]} complexity</Chip>
      </div>
      <ol aria-label="Where we are" className="mt-4 flex flex-col">
        {milestones.map((m, k) => {
          const s = STATE[m.state];
          const last = k === milestones.length - 1;
          return (
            <li key={m.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={m.state === "current" || m.state === "waiting" ? "step" : undefined}>
              {!last && <span aria-hidden className={cx("absolute left-[11px] top-6 h-[calc(100%-18px)] w-px", m.state === "done" ? "bg-good/40" : "bg-line-2")} />}
              <span aria-hidden className={cx("relative z-[1] grid size-6 shrink-0 place-items-center rounded-full border", s.ring)}>
                {s.icon}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cx("text-[13.5px] leading-tight", m.state === "todo" ? "text-fog" : "font-medium text-ink")}>
                  {m.label}
                  <span className="sr-only">: {s.word}</span>
                </p>
                <p className={cx("mt-0.5 text-[12px] leading-snug", m.state === "blocked" ? "text-warn" : m.state === "waiting" ? "text-gold-2" : "text-mist")}>{m.note}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

const TONE = { good: "good", warn: "warn", default: "default", violet: "violet" } as const;

export function DocumentCards({ cards, onOpen }: { cards: ArtifactCard[]; onOpen: (id: ArtifactCard["id"]) => void }) {
  return (
    <section aria-label="Documents" className="flex flex-col gap-2.5">
      <Eyebrow className="px-1">Documents</Eyebrow>
      {cards.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-label={`Open ${c.title}`}
          onClick={() => onOpen(c.id)}
          className="group flex flex-col gap-1.5 rounded-2xl border border-line bg-panel px-4 py-3 text-left transition-colors hover:border-line-2 hover:bg-panel-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
        >
          <span className="flex w-full items-center gap-2">
            <span className="text-[13.5px] font-semibold">{c.title}</span>
            <Chip tone={TONE[c.tone]}>{c.status}</Chip>
            <ArrowUpRight className="ml-auto size-4 shrink-0 text-mist transition-colors group-hover:text-ink" />
          </span>
          {c.lines.map((l) => (
            <span key={l} className="line-clamp-2 text-[12.5px] leading-snug text-fog">
              {l}
            </span>
          ))}
        </button>
      ))}
    </section>
  );
}

/** A document's full text, beside the conversation; Escape or the backdrop closes it. */
export function DocDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div aria-hidden className="absolute inset-0 bg-bg/60 backdrop-blur-[2px] motion-safe:animate-[card-rise_200ms_ease-out]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[780px] flex-col border-l border-line bg-panel shadow-2xl motion-safe:animate-[drawer-in_260ms_cubic-bezier(0.2,0.9,0.3,1)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button ref={close} type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-lg p-1.5 text-mist hover:bg-panel-2 hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
