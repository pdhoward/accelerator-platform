"use client";

import Link from "next/link";
import { useState } from "react";
import { BOARDING_STEPS, INTERVIEW_FORM, type Boarding, type FormValues } from "@accelerator/domain";
import { Check, Circle, CircleDot, Hand } from "lucide-react";

import { browserApi } from "@/lib/browser-api";
import { FormRenderer } from "./form-renderer";
import { button, Card, CardBody, CardHead, Chip, cx } from "./ui";
import { useUi } from "./ui-provider";

/**
 * Boarding (gen2-crew.md §2.5, G2.6): one guided flow, $2,500 fixed price.
 * Every step's state is computed from the records, never ticked by hand;
 * the next action names who does it. A person stepping in is logged, and
 * each log entry is a backlog item for the Boarding crew.
 */

type Interview = { values: FormValues; version: number; at: string; by: string } | null;

export function BoardingView({ siteId, initial, canAnswer, canLog }: { siteId: string; initial: Boarding & { interview: Interview }; canAnswer: boolean; canLog: boolean }) {
  const [b, setB] = useState(initial);
  const [step, setStep] = useState<string>(initial.steps.find((s) => s.state === "current")?.id ?? "checkup");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const api = browserApi();
  const reload = async () => setB(await api.boarding.get(siteId));

  return (
    <>
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4 pt-5" data-boarding-summary>
          <div>
            <div className="text-[12px] text-mist">Fixed price</div>
            <div className="text-2xl font-semibold">${b.priceUsd.toLocaleString("en-US")}</div>
          </div>
          <div className="min-w-[200px] flex-1">
            <div className="flex justify-between text-[12px] text-mist">
              <span>{b.complete ? "Boarding is complete" : `Step ${Math.min(b.done + 1, b.total)} of ${b.total}`}</span>
              <span>{b.done}/{b.total} done</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={b.total} aria-valuenow={b.done} aria-label="Boarding progress">
              <div className="h-full rounded-full bg-violet transition-[width] duration-500" style={{ width: `${(b.done / b.total) * 100}%` }} />
            </div>
          </div>
          {b.next && (
            <p className="w-full text-[13px] text-fog" data-next>
              <strong className="font-medium text-ink">Next:</strong> {b.next.label} <span className="text-mist">({b.next.step} · {b.next.who})</span>
            </p>
          )}
        </CardBody>
      </Card>

      <ol className="flex flex-col gap-3" aria-label="Boarding steps">
        {b.steps.map((s, i) => (
          <li key={s.id}>
            <Card className={cx(s.state === "current" && "border-violet/60")}>
              <CardBody className="grid gap-3 pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-step={s.id} data-state={s.state}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.state === "done" ? <Check className="size-4 text-good" aria-label="Done" /> : s.state === "current" ? <CircleDot className="size-4 text-violet" aria-label="Current" /> : <Circle className="size-4 text-mist" aria-label="To do" />}
                    <h2 className="text-[14px] font-semibold">{i}. {s.label}</h2>
                    <Chip>{s.specialistLabel}</Chip>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-snug text-fog">{s.what}</p>
                  <p className="mt-1 text-[12px] text-mist">You: {s.clientDoes}</p>
                  <Link href={`/s/${siteId}/${s.where.path}`} className="mt-1.5 inline-block text-[12px] text-violet hover:underline">Open {s.where.label} →</Link>
                </div>
                <ul className="flex flex-col gap-1.5 text-[12.5px]">
                  {s.checks.map((c) => (
                    <li key={c.label} className={cx("flex items-start gap-2", c.done ? "text-fog" : "text-ink")}>
                      {c.done ? <Check className="mt-0.5 size-3.5 shrink-0 text-good" aria-label="Done" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-mist" aria-label="Not yet" />}
                      <span>{c.label}{!c.done && <span className="text-mist"> · {c.who === "client" ? "you" : c.who === "crew" ? "the crew" : "Strategic Machines"}</span>}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>

      <Card>
        <CardHead title="The interview" hint={b.interview ? `v${b.interview.version}, ${b.interview.at.slice(0, 10)} by ${b.interview.by}` : "Not saved yet"} />
        <CardBody data-interview>
          {canAnswer ? (
            <FormRenderer
              spec={INTERVIEW_FORM}
              initial={b.interview?.values ?? null}
              submitLabel={b.interview ? `Save as v${b.interview.version + 1}` : undefined}
              onSubmit={async (values) => {
                try {
                  const r = await api.boarding.interview(siteId, values);
                  await reload();
                  toast(`Interview v${r.version} saved. The crew reads it on every run.`);
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Couldn't save the interview.");
                }
              }}
            />
          ) : (
            <p className="text-[13px] text-mist">The account&apos;s own people answer the interview. Prepare it with them in the conversation.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Where a person stepped in" hint="Each one becomes a backlog item for the Boarding crew" />
        <CardBody className="flex flex-col gap-3" data-interventions>
          {canLog && (
            <form
              className="flex flex-col gap-2 md:flex-row"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await api.boarding.intervention(siteId, step, note);
                  setNote("");
                  await reload();
                  toast("Logged.");
                } catch (err) {
                  toast(err instanceof Error ? err.message : "Couldn't log it.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="sr-only" htmlFor="iv-step">Step</label>
              <select id="iv-step" value={step} onChange={(e) => setStep(e.target.value)} className="rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-ink">
                {BOARDING_STEPS.map((s) => <option key={s} value={s}>{b.steps.find((x) => x.id === s)?.label ?? s}</option>)}
              </select>
              <label className="sr-only" htmlFor="iv-note">What had to be done by hand</label>
              <input id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What had to be done by hand, and why" className="min-w-0 flex-1 rounded-lg border border-line-2 bg-panel-2 px-3 py-2 text-[13px] text-ink placeholder:text-mist" />
              <button type="submit" className={button("plain")} disabled={busy || note.trim().length < 5}>
                <Hand className="size-4" /> Log it
              </button>
            </form>
          )}
          {b.interventions.length === 0 ? (
            <p className="text-[13px] text-mist">None logged yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[12.5px] text-fog">
              {b.interventions.map((iv) => (
                <li key={`${iv.at}-${iv.note}`}>
                  <span className="font-mono text-[11px] text-mist">{iv.at.slice(0, 10)}</span> <Chip>{b.steps.find((s) => s.id === iv.step)?.label ?? iv.step}</Chip> {iv.note} <span className="text-mist">({iv.by})</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
