"use client";
import { timestamp } from "@/lib/format";
import { ArrowRight, Check, Clock3, CircleAlert } from "lucide-react";
import type { StudioSnapshot } from "@accelerator/domain";
import { cx } from "../ui";

/** Compact role/status projection; motion is driven by recorded event arrival. */
export function ActivityRibbon({
  studio,
  paused,
}: {
  studio: StudioSnapshot;
  paused: boolean;
}) {
  const latest = studio.activity.at(-1);
  return (
    <section
      aria-label="Crew activity"
      className="overflow-hidden rounded-2xl border border-line bg-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 text-xs">
        <span className="font-medium text-fog">
          Crew activity ·{" "}
          {studio.source === "sample"
            ? "illustrative"
            : paused
              ? "visual motion paused"
              : "recorded job states"}
        </span>
        <span className="text-mist">
          No continuous listening · model calls run only for jobs
        </span>
      </div>
      <ol className="grid divide-y divide-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
        {studio.crew.map((c) => (
          <li key={c.role} className="min-w-0 px-4 py-4">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cx(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg border",
                  c.state === "working"
                    ? "border-cyan/40 bg-cyan/10 text-cyan"
                    : c.state === "blocked"
                      ? "border-bad/40 text-bad"
                      : c.state === "completed"
                        ? "border-good/30 text-good"
                        : "border-line-2 text-mist",
                )}
              >
                {c.state === "completed" ? (
                  <Check className="size-3.5" />
                ) : c.state === "blocked" ? (
                  <CircleAlert className="size-3.5" />
                ) : (
                  <Clock3
                    className={cx(
                      "size-3.5",
                      c.state === "working" &&
                        !paused &&
                        "motion-safe:animate-pulse",
                    )}
                  />
                )}
              </span>
              <span className="text-xs font-medium">{c.label}</span>
            </div>
            <p
              className={cx(
                "text-xs capitalize",
                c.state === "working"
                  ? "text-cyan"
                  : c.state === "blocked"
                    ? "text-bad"
                    : "text-fog",
              )}
            >
              {c.state}
            </p>
            <p className="mt-1 break-words text-[11px] text-mist">{c.task}</p>
          </li>
        ))}
      </ol>
      {latest && (
        <div
          key={latest.id}
          className={cx(
            "flex flex-wrap items-center gap-2 border-t border-line px-4 py-3",
            !paused && "activity-arrival",
          )}
        >
          <span className="size-1.5 rounded-full bg-cyan" aria-hidden />
          <span className="text-xs text-fog">Latest recorded event</span>
          <span className="text-xs font-medium">{latest.title}</span>
          <time dateTime={latest.at} className="ml-auto text-[11px] text-mist">
            {timestamp(latest.at)}
          </time>
        </div>
      )}
      <p className="flex items-center gap-2 border-t border-line px-4 py-2 text-[11px] text-mist">
        <ArrowRight className="size-3 shrink-0" /> Roles map existing job kinds;
        this is not yet a configured specialist roster. Completed means the job
        ended, not that release is approved.
      </p>
    </section>
  );
}
