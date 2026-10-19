"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, Sparkles, X } from "lucide-react";
import { COMPLEXITY_LABEL, type WorkItem } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { button, cx } from "./ui";

/**
 * The global composer (gen2-crew.md §17 F5, R7): ⌘K (Ctrl+K) or the button on
 * any site page. Say what you want and it starts a Work item for the crew, or
 * jump straight to an open item that matches.
 */
export function CommandComposer({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    input.current?.focus();
    void browserApi()
      .work.list(siteId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [open, siteId]);

  const matches = useMemo(() => {
    const open = (items ?? []).filter((w) => w.kind === "change" && w.stage !== "done" && w.stage !== "cancelled");
    const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const scored = open.map((w) => ({ w, score: words.filter((x) => w.title.toLowerCase().includes(x)).length }));
    return (words.length ? scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score) : scored).slice(0, 5).map((s) => s.w);
  }, [items, text]);

  async function start() {
    const message = text.trim();
    if (message.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    const first = message.split(/\n|(?<=[.!?])\s/)[0]!.trim();
    const title = (first.length >= 3 ? first : message).slice(0, 80).replace(/[.!?]$/, "");
    try {
      const { number } = await browserApi().work.create(siteId, { title: title.length >= 3 ? title : "New improvement", message });
      setOpen(false);
      setText("");
      router.push(`/s/${encodeURIComponent(siteId)}/work/${number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the crew (Ctrl+K)"
        title="Ask the crew (⌘K / Ctrl+K)"
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-panel px-4 py-2.5 text-[13px] font-semibold text-ink shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] transition-transform hover:-translate-y-0.5"
      >
        <Sparkles className="size-4 text-gold-2" /> Ask the crew <kbd className="rounded border border-line-2 px-1.5 font-mono text-[10.5px] text-mist">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Ask the crew">
          <div aria-hidden className="absolute inset-0 bg-bg/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl motion-safe:animate-[card-rise_200ms_ease-out]">
            <div className="flex items-start gap-3 p-4">
              <Sparkles className="mt-2 size-5 shrink-0 text-gold-2" />
              <label htmlFor="composer" className="sr-only">
                What should the crew do?
              </label>
              <textarea
                id="composer"
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void start();
                  }
                }}
                rows={3}
                placeholder="What should the crew do? Describe what you noticed or want, in your own words."
                className="min-h-[72px] flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-mist"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-mist hover:bg-panel-2 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            {error && (
              <p role="alert" className="px-4 pb-2 text-[12.5px] text-bad">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2 border-t border-line bg-panel-2/40 px-4 py-2.5">
              <span className="text-[11.5px] text-mist">Enter starts a new improvement · the lead rates its complexity · Esc closes</span>
              <button type="button" className={button("gold", "text-xs")} disabled={busy || text.trim().length < 3} onClick={() => void start()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Start
              </button>
            </div>
            {matches.length > 0 && (
              <div className="border-t border-line px-2 py-2">
                <p className="px-2 pb-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mist">{text.trim() ? "Already underway" : "Open items"}</p>
                <ul>
                  {matches.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          router.push(`/s/${encodeURIComponent(siteId)}/work/${w.number}`);
                        }}
                        className={cx("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px] hover:bg-panel-2")}
                      >
                        <span className="font-mono text-[11px] text-mist">#{w.number}</span>
                        <span className="min-w-0 flex-1 truncate">{w.title}</span>
                        <span className="text-[11px] text-mist">{COMPLEXITY_LABEL[w.complexity]}</span>
                        <ArrowUpRight className="size-3.5 text-mist" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
