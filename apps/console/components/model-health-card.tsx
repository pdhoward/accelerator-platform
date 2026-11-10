import type { ModelHealth, SourceHealth } from "@accelerator/domain";

import { Card, CardBody, CardHead, Chip, cx } from "./ui";

/**
 * Model health (gen3-cradle.md B18): can the running app and the crew reach
 * their AI model? When they can't, what's wrong and how to fix it. The app
 * reports each failure; a later successful call marks it working again.
 */

const TONE = { ok: "good", degraded: "warn", down: "bad", unknown: "default" } as const;
const WORD = { ok: "Working", degraded: "Unreliable", down: "Unavailable", unknown: "No calls yet" } as const;
const when = (at: string) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function ModelHealthCard({ health, note }: { health: ModelHealth | null; note?: string | null }) {
  const bad = health && (health.status === "down" || health.status === "degraded");
  return (
    <Card className={cx(bad && "border-bad/50")}>
      <CardHead title="AI models" hint="Whether the running app and the crew can reach their AI model. A failure shows here with the fix, not just in the logs." />
      <CardBody className="flex flex-col gap-3">
        {!health ? (
          <p className="text-[13px] text-mist">{note ?? "Model health isn't available."}</p>
        ) : (
          <>
            <p className={cx("text-[14px] font-medium", health.status === "down" ? "text-bad" : health.status === "degraded" ? "text-warn" : health.status === "ok" ? "text-good" : "text-fog")}>{health.headline}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {health.sources.map((s) => <Source key={s.source} s={s} />)}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Source({ s }: { s: SourceHealth }) {
  const live = s.status === "down" || s.status === "degraded";
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel-2 p-3.5 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{s.label}</span>
        <Chip tone={TONE[s.status]}>{WORD[s.status]}</Chip>
      </div>
      {s.fault && live && (
        <>
          <p><b>{s.fault.label}</b> <span className="text-mist">· {s.fault.model} · {s.fault.role} · {when(s.fault.at)}</span></p>
          <p className="text-fog"><b className="text-ink">Fix:</b> {s.fault.fix}</p>
          <p className="font-mono text-[11.5px] text-mist break-words">{s.fault.message}</p>
        </>
      )}
      {s.status === "ok" && (
        <p className="text-fog">
          {s.recoveredAt && s.fault ? `Working again since ${when(s.recoveredAt)}, after "${s.fault.label}" at ${when(s.fault.at)}.` : s.lastOkAt ? `Last successful call ${when(s.lastOkAt)}.` : "Working."}
        </p>
      )}
      {s.status === "unknown" && <p className="text-mist">{s.source === "app" ? "The app hasn't reported a model call yet." : "No crew job has run in the last week."}</p>}
      {s.faults24h > 0 && <p className="text-[12px] text-mist">{s.faults24h} failed {s.faults24h === 1 ? "call" : "calls"} in the last 24 hours</p>}
    </div>
  );
}
