import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, CircleDashed, Loader2, OctagonAlert, SkipForward } from "lucide-react";
import { RAIL, RAIL_LABEL, type StepStatus, type WorkStage } from "@accelerator/domain";

import { cx } from "./ui";

/** The rail: eight stops, where this Work item is, what's behind it. Server-safe. */
export function Rail({ stage, compact = false }: { stage: WorkStage; compact?: boolean }) {
  const at = RAIL.indexOf(stage as (typeof RAIL)[number]);
  const done = stage === "done";
  return (
    <ol className={cx("flex items-center", compact ? "gap-1" : "gap-1.5 overflow-x-auto")} aria-label="Progress">
      {RAIL.map((stop, i) => {
        const past = done || (at >= 0 && i < at);
        const current = !done && i === at;
        return (
          <li key={stop} className="flex items-center gap-1.5" aria-current={current ? "step" : undefined}>
            {i > 0 && <span className={cx("h-px", compact ? "w-2" : "w-4", past || current ? "bg-violet/60" : "bg-line-2")} aria-hidden />}
            {compact ? (
              <span
                title={RAIL_LABEL[stop]}
                className={cx("size-2 rounded-full", current ? "bg-gold ring-2 ring-gold/30" : past ? "bg-violet" : "bg-line-2")}
              />
            ) : (
              <span
                className={cx(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] font-medium",
                  current ? "border-gold bg-gold/10 text-gold-2" : past ? "border-violet/40 bg-violet/10 text-ink" : "border-line text-mist",
                )}
              >
                {past && <Check className="size-3" />}
                {RAIL_LABEL[stop]}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const STEP_ICON: Record<StepStatus, { icon: typeof Check; cls: string; label: string }> = {
  todo: { icon: CircleDashed, cls: "text-mist", label: "To do" },
  running: { icon: Loader2, cls: "animate-spin text-gold-2", label: "Building" },
  done: { icon: Check, cls: "text-good", label: "Done" },
  blocked: { icon: OctagonAlert, cls: "text-bad", label: "Blocked" },
  skipped: { icon: SkipForward, cls: "text-mist", label: "Skipped" },
};

export function StepIcon({ status }: { status: StepStatus }) {
  const s = STEP_ICON[status];
  const Icon = s.icon;
  return <Icon className={cx("size-4 shrink-0", s.cls)} aria-label={s.label} />;
}

/** Markdown the way the Control Room shows documents and replies. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cx(
        "text-[13.5px] leading-relaxed text-ink",
        "[&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[15px] [&_h2]:font-semibold",
        "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-panel-2 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_a]:text-cyan [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line-2 [&_blockquote]:pl-3 [&_blockquote]:text-fog",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
