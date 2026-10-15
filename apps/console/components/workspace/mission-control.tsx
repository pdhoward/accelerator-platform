"use client";
import { timestamp } from "@/lib/format";
import { CREW_LABEL, type StudioSnapshot } from "@accelerator/domain";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { button, Card, Chip, Eyebrow } from "../ui";
/** Inspectable execution chronology and recorded job model settings. */
export function MissionControl({
  studio,
  inspect,
}: {
  studio: StudioSnapshot;
  inspect: (target: "design" | "plan" | "ship" | "log") => void;
}) {
  const events = studio.activity.slice(-60);
  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <Card className="p-5">
        <Eyebrow>Mission Control</Eyebrow>
        <h2 className="mt-2 text-xl font-semibold">
          Follow the work, not the chatter.
        </h2>
        <p className="mt-2 text-sm text-fog">
          Chronological execution trace. Lines show sequence, not inferred
          dependencies or unseen conversations.
        </p>
        <ol className="mt-5">
          {events.map((e, i) => (
            <li key={e.id} className="relative flex gap-3 pb-5">
              <div className="flex w-7 shrink-0 flex-col items-center">
                <span className="flex size-7 items-center justify-center rounded-full border border-violet/40 bg-violet/10 font-mono text-[10px]">
                  {i + 1}
                </span>
                {i < events.length - 1 && (
                  <ArrowDown className="mt-2 size-3 text-line-2" />
                )}
              </div>
              <div className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-cyan">
                    {e.role ? CREW_LABEL[e.role] : "Decision record"}
                  </span>
                  <span className="font-mono text-[10px] text-mist">
                    {timestamp(e.at)}
                  </span>
                </div>
                <h3 className="mt-1 font-medium">{e.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-fog">
                  {e.detail}
                </p>
                {e.model && (
                  <p className="mt-2 break-all font-mono text-[11px] text-mist">
                    {e.provider ? `${e.provider} / ` : ""}
                    {e.model}
                  </p>
                )}
                <button
                  type="button"
                  className={button("ghost", "mt-2 text-xs")}
                  onClick={() => inspect(e.target)}
                >
                  Inspect artifact / log <ArrowUpRight className="size-3" />
                </button>
              </div>
            </li>
          ))}
        </ol>
        {studio.activity.length > 60 && (
          <p className="text-xs text-warn">
            Showing the last 60 of {studio.activity.length} available events.
            Replay includes the full available snapshot.
          </p>
        )}
      </Card>
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <Eyebrow>Recorded job model settings</Eyebrow>
          <div className="mt-4 space-y-4">
            {studio.crew.map((c) => (
              <div key={c.role}>
                <h3 className="text-sm font-medium">{c.label}</h3>
                <p className="mt-1 break-all font-mono text-xs text-fog">
                  {c.model ?? "No job/model recorded"}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-mist">
            These are model settings stored on jobs, not provider invocation
            receipts. Some jobs run deterministic checks without calling an LLM.
            No model switch is executed by changing this view.
          </p>
        </Card>
        <Card className="p-5">
          <Chip tone="warn">Measurement gaps</Chip>
          <p className="mt-3 text-sm text-fog">
            Token use, cost and a complete dependency graph are not yet
            instrumented here. No throughput or savings are inferred from
            animation.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-4 text-xs text-mist">
            {studio.coverage.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
