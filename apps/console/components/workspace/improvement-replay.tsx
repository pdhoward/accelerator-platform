"use client";
import { timestamp } from "@/lib/format";
import { useEffect, useState } from "react";
import {
  MODEL_ROLES,
  CREW_LABEL,
  replayFrame,
  type ActivityEvent,
  type StudioSnapshot,
} from "@accelerator/domain";
import { Pause, Play, RotateCcw, SkipForward, X } from "lucide-react";
import { button, Card, Chip, cx, Eyebrow } from "../ui";

/** Frozen evidence playback only: never dispatches a job, mutation or approval. */
export function ImprovementReplay({
  studio,
  close,
}: {
  studio: StudioSnapshot;
  close: () => void;
}) {
  const [snapshot] = useState(() => ({
    events: studio.activity.map((e) => ({ ...e })),
    source: studio.source,
    capturedAt: studio.observedAt,
    coverage: [...studio.coverage],
  }));
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => {
      if (m.matches) setPlaying(false);
    };
    stop();
    m.addEventListener("change", stop);
    return () => m.removeEventListener("change", stop);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setCursor((c) => Math.min(snapshot.events.length, c + 1)),
      1300 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, snapshot.events.length]);
  useEffect(() => {
    if (cursor >= snapshot.events.length) setPlaying(false);
  }, [cursor, snapshot.events.length]);
  const frame = replayFrame(snapshot.events, cursor);
  const event = frame.at(-1);
  return (
    <Card className="overflow-hidden border-violet/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-violet/10 p-4">
        <div>
          <Eyebrow>Replay this improvement</Eyebrow>
          <p className="mt-1 text-xs text-fog">
            Recorded snapshot · compressed time · read-only ·{" "}
            {snapshot.source === "sample"
              ? "illustrative data"
              : "available evidence"}
          </p>
        </div>
        <button
          type="button"
          className={button("ghost")}
          onClick={close}
          aria-label="Close replay"
        >
          <X className="size-4" /> Close replay
        </button>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 className="text-xl font-semibold">
            See how the improvement unfolded.
          </h2>
          <p className="mt-2 text-sm text-fog">
            The replay is frozen at {timestamp(snapshot.capturedAt)}. Live
            updates below do not alter this snapshot. Playback never re-executes
            work.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={button("gold")}
              disabled={!snapshot.events.length}
              onClick={() => {
                if (cursor >= snapshot.events.length) setCursor(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {playing ? "Pause replay" : "Play replay"}
            </button>
            <button
              type="button"
              className={button("plain")}
              onClick={() => {
                setPlaying(false);
                setCursor(0);
              }}
            >
              <RotateCcw className="size-4" /> Restart
            </button>
            <button
              type="button"
              className={button("plain")}
              disabled={cursor >= snapshot.events.length}
              onClick={() => {
                setPlaying(false);
                setCursor((c) => Math.min(snapshot.events.length, c + 1));
              }}
            >
              <SkipForward className="size-4" /> Next event
            </button>
            <select
              aria-label="Replay speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded-lg border border-line-2 bg-panel px-2 text-sm"
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>
          <label
            className="mt-5 block text-xs text-fog"
            htmlFor="replay-cursor"
          >
            Event {cursor} of {snapshot.events.length}
          </label>
          <input
            id="replay-cursor"
            className="mt-2 w-full accent-violet"
            type="range"
            min={0}
            max={snapshot.events.length}
            value={cursor}
            aria-label="Replay event position"
            onChange={(e) => {
              setPlaying(false);
              setCursor(Number(e.target.value));
            }}
          />
          <ol className="mt-4 space-y-2 text-xs text-fog">
            {frame.slice(-5).map((e) => (
              <li key={e.id} className="border-l-2 border-violet/50 pl-3">
                {e.title}
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-2xl border border-violet/30 bg-gradient-to-br from-violet/10 to-cyan/5 p-5">
          <Chip tone="violet">Replay · not live</Chip>
          <div
            className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5"
            aria-label="Replay event role focus"
          >
            {MODEL_ROLES.map((role) => (
              <div
                key={role}
                className={cx(
                  "rounded-lg border p-2 text-center text-[10px]",
                  event?.role === role
                    ? "border-cyan/60 bg-cyan/10 text-cyan"
                    : "border-line text-mist",
                )}
              >
                {CREW_LABEL[role]}
              </div>
            ))}
          </div>
          <div key={event?.id ?? "start"} className="activity-arrival">
            <ReplayEvent event={event} />
          </div>
          <p className="mt-5 border-t border-line pt-3 text-xs leading-relaxed text-mist">
            {snapshot.coverage[0]} Historical artifacts may have newer versions
            in the live workspace.
          </p>
        </div>
      </div>
    </Card>
  );
}
function ReplayEvent({ event }: { event?: ActivityEvent }) {
  return event ? (
    <div className="mt-6">
      <p className="text-xs uppercase tracking-widest text-cyan">
        {event.role ? CREW_LABEL[event.role] : "Decision record"}
      </p>
      <h3 className="mt-3 text-2xl font-semibold">{event.title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-fog">{event.detail}</p>
      <p className="mt-4 font-mono text-xs text-mist">{timestamp(event.at)}</p>
      {event.model && (
        <p className="mt-2 break-all font-mono text-xs text-mist">
          {event.provider} {event.model}
        </p>
      )}
    </div>
  ) : (
    <p className="mt-6 text-lg text-fog">
      Ready at the beginning. Play or step through the recorded events.
    </p>
  );
}
