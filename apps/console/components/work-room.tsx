"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, CircleCheck, FileText, ListChecks, Loader2, PenLine, Play, ScrollText, Sparkles, User, Wifi, WifiOff } from "lucide-react";
import { CADENCE_LABEL, modelLabel, RAIL_LABEL, type Cadence, type WorkDetail, type WorkStep } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { inputClass } from "./action-form";
import { Markdown, Rail, StepIcon } from "./flywheel";
import { button, Card, Chip, cx, Eyebrow, PageHeader } from "./ui";
import { EngineerOnly, useUi } from "./ui-provider";

type Tab = "design" | "plan" | "log";

/**
 * One Work item: the conversation (left) never goes away; the right side is
 * whatever the current stop produces (design · plan · live log). The page
 * refreshes itself while the engine works.
 */
export function WorkRoom({ siteId, initial, canAsk, canApprove }: { siteId: string; initial: WorkDetail; canAsk: boolean; canApprove: boolean }) {
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState<Tab>(defaultTab(initial));
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const n = d.work.number;
  const api = browserApi();

  const job = d.jobs[0];
  const working = !!job && (job.status === "queued" || job.status === "running");

  const refresh = useCallback(async () => {
    try {
      setD(await browserApi().work.get(siteId, n));
    } catch {}
  }, [siteId, n]);

  useEffect(() => {
    const t = setInterval(refresh, working ? 2500 : 12000);
    return () => clearInterval(t);
  }, [refresh, working]);

  // Follow the rail: when a new design or plan lands, show it.
  const seen = useRef({ designs: d.designs.length, steps: d.steps.length, job: job?.id });
  useEffect(() => {
    if (d.designs.length > seen.current.designs) setTab("design");
    else if (d.steps.length !== seen.current.steps && d.steps.length) setTab("plan");
    if (job?.id !== seen.current.job && job && (job.status === "queued" || job.status === "running") && job.kind === "build_step") setTab("log");
    seen.current = { designs: d.designs.length, steps: d.steps.length, job: job?.id };
  }, [d, job]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const a = d.actions;
  const latest = d.designs.at(-1);
  const next = a.nextStep != null ? (d.steps[a.nextStep] ?? null) : null;
  const install = d.work.kind === "install";

  return (
    <>
      <PageHeader title={`#${n} ${d.work.title}`} sub={d.work.branch ? `Branch ${d.work.branch}` : undefined}>
        <RunnerBadge online={d.runnerOnline} />
        {canApprove && (
          <select
            aria-label="How often the engine stops to ask"
            value={d.work.cadence}
            onChange={(e) => act(() => api.work.cadence(siteId, n, e.target.value as Cadence), "Cadence saved.")}
            className="rounded-lg border border-line-2 bg-panel px-2.5 py-1.5 text-[12.5px] text-fog"
          >
            {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
              <option key={c} value={c}>
                {CADENCE_LABEL[c]}
              </option>
            ))}
          </select>
        )}
      </PageHeader>

      <div className="flex flex-col gap-4 px-6 pb-16 pt-5 lg:px-8">
        {install ? (
          <p className="text-[13px] text-fog">The installation conversation: ask the engine about anything on the Setup page. It sees the checklist, the checkout log and which keys are set (never their values), and can read the code.</p>
        ) : (
          <Rail stage={d.work.stage} />
        )}

        <NeedsYou d={d} working={working} canApprove={canApprove} busy={busy} onTab={setTab} act={act} siteId={siteId} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <Thread d={d} working={working} canAsk={canAsk} busy={busy} onSend={(body) => act(() => api.work.say(siteId, n, body))} />

          <Card className="flex min-h-[520px] flex-col">
            <nav className="flex gap-1 border-b border-line px-3 pt-3" aria-label="Work item documents">
              {(
                [
                  ["design", `Design${latest ? ` v${latest.version}` : ""}`, FileText],
                  ["plan", `Plan${d.steps.length ? ` · ${d.steps.filter((s) => s.status === "done").length}/${d.steps.length}` : ""}`, ListChecks],
                  ["log", "Live log", ScrollText],
                ] as const
              ).filter(([id]) => !install || id === "log").map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={tab === id}
                  className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]", tab === id ? "border-gold text-ink" : "border-transparent text-fog hover:text-ink")}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto p-4">
              {tab === "design" && (
                <DesignPanel d={d} canAsk={canAsk} canApprove={canApprove} busy={busy || working} siteId={siteId} act={act} />
              )}
              {tab === "plan" && <PlanPanel d={d} canAsk={canAsk} canApprove={canApprove} busy={busy || working} siteId={siteId} act={act} next={next} />}
              {tab === "log" && <LogPanel d={d} />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function defaultTab(d: WorkDetail): Tab {
  if (d.work.kind === "install") return "log";
  const j = d.jobs[0];
  if (j && j.kind === "build_step" && (j.status === "queued" || j.status === "running")) return "log";
  if (d.work.stage === "plan" || d.work.stage === "build" || d.work.stage === "prove") return "plan";
  return "design";
}

function RunnerBadge({ online }: { online: boolean }) {
  return online ? (
    <Chip tone="good">
      <Wifi className="size-3" /> Engine online
    </Chip>
  ) : (
    <Chip tone="warn">
      <WifiOff className="size-3" /> Engine offline
    </Chip>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

/** The one next decision, in plain words (F9: the engine asks, visibly). */
function NeedsYou({ d, working, canApprove, busy, onTab, act, siteId }: { d: WorkDetail; working: boolean; canApprove: boolean; busy: boolean; onTab: (t: Tab) => void; act: Act; siteId: string }) {
  const a = d.actions;
  const api = browserApi();
  const n = d.work.number;
  const latest = d.designs.at(-1);
  const blocked = d.steps.find((s) => s.status === "blocked");
  const doneCount = d.steps.filter((s) => s.status === "done").length;
  const job = d.jobs[0];

  let text: string | null = null;
  let action: React.ReactNode = null;
  if (working) {
    text = `The engine is working: ${job!.kind === "build_step" ? "building a step" : job!.kind === "discuss" ? "replying" : `writing the ${job!.kind}`} (${modelLabel(job!.provider, job!.model)}).`;
    action = <Loader2 className="size-4 animate-spin text-gold-2" />;
  } else if (!d.runnerOnline) {
    text = "The engine is offline. Start the runner and it will pick up where things are.";
  } else if (d.work.kind === "install") {
    return null;
  } else if (a.approveDesign && latest) {
    text = `Design v${latest.version} is ready. Read it, edit it, or ask for changes in the conversation.`;
    action = canApprove ? (
      <button type="button" className={button("gold")} disabled={busy} onClick={() => act(() => api.work.design(siteId, n, { action: "approve", version: latest.version }), "Design approved.")}>
        <CircleCheck className="size-4" /> Approve design v{latest.version}
      </button>
    ) : (
      <button type="button" className={button("plain")} onClick={() => onTab("design")}>Read the design</button>
    );
  } else if (a.approvePlan) {
    text = `The plan has ${d.steps.length} steps. Approve it and the engine builds step 1.`;
    action = canApprove ? (
      <button type="button" className={button("gold")} disabled={busy} onClick={() => act(() => api.work.plan(siteId, n, { action: "approve" }), "Plan approved.")}>
        <CircleCheck className="size-4" /> Approve plan
      </button>
    ) : null;
  } else if (a.runNextStep && a.nextStep != null) {
    const step = d.steps[a.nextStep]!;
    text = blocked
      ? `Step ${blocked.position} is blocked by the Protocol. Ask the engine to fix it in the conversation, or run it again.`
      : doneCount
        ? `Step ${doneCount} of ${d.steps.length} is done and checked. Proceed to step ${step.position}?`
        : `Ready to build step 1: ${step.title}.`;
    action = canApprove ? (
      <button type="button" className={button("gold")} disabled={busy} onClick={() => act(() => api.work.next(siteId, n), `Building step ${step.position}.`)}>
        <Play className="size-4" /> {blocked ? `Run step ${step.position} again` : `Build step ${step.position}`}
      </button>
    ) : null;
  } else if (d.work.stage === "prove") {
    text = `All ${d.steps.length} steps are built and checked. Next: preview deploys and Try (coming with the GitHub + Vercel setup).`;
  } else if (a.draftPlan) {
    text = "The design is approved. Ask the engine for the build plan.";
    action = (
      <button type="button" className={button("gold")} disabled={busy} onClick={() => act(() => api.work.plan(siteId, n, { action: "draft" }), "Writing the plan.")}>
        <ListChecks className="size-4" /> Write the plan
      </button>
    );
  } else if (d.work.stage === "discuss" && d.messages.length > 1) {
    text = "When you and the engine agree on the idea, ask it to draft the design.";
    action = (
      <button type="button" className={button("plain")} disabled={busy} onClick={() => act(() => api.work.design(siteId, n, { action: "draft" }), "Drafting the design.")}>
        <PenLine className="size-4" /> Draft the design
      </button>
    );
  }

  if (!text) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold/35 bg-gold/[0.07] px-4 py-3">
      <Sparkles className="size-4 shrink-0 text-gold-2" />
      <p className="min-w-0 flex-1 text-[13.5px]">
        <span className="font-semibold text-gold-2">Needs you · </span>
        {text}
      </p>
      {action}
    </div>
  );
}

function Thread({ d, working, canAsk, busy, onSend }: { d: WorkDetail; working: boolean; canAsk: boolean; busy: boolean; onSend: (body: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [d.messages.length]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await onSend(body);
  }

  return (
    <Card className="flex max-h-[78vh] min-h-[520px] flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <Eyebrow>Conversation</Eyebrow>
        <span className="text-[12px] text-mist">Consult: {modelLabel(d.models.consult.provider, d.models.consult.model)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {d.messages.map((m) =>
          m.authorKind === "system" ? (
            <p key={m.id} className="self-center rounded-full bg-panel-2 px-3 py-1 text-center text-[12px] text-mist">
              {m.body}
            </p>
          ) : (
            <div key={m.id} className={cx("flex gap-2.5", m.authorKind === "person" && "flex-row-reverse")}>
              <span className={cx("grid size-7 shrink-0 place-items-center rounded-full", m.authorKind === "person" ? "bg-violet/20 text-violet" : "bg-gold/15 text-gold-2")}>
                {m.authorKind === "person" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
              </span>
              <div className={cx("max-w-[88%] rounded-2xl px-3.5 py-2.5", m.authorKind === "person" ? "rounded-tr-md bg-violet/12" : "rounded-tl-md bg-panel-2")}>
                <p className="mb-1 text-[11.5px] text-mist">
                  {m.authorLabel} · {RAIL_LABEL[m.stage as keyof typeof RAIL_LABEL] ?? m.stage}
                </p>
                {m.authorKind === "model" ? <Markdown>{m.body}</Markdown> : <p className="whitespace-pre-wrap text-[13.5px]">{m.body}</p>}
              </div>
            </div>
          ),
        )}
        {working && (
          <p className="flex items-center gap-2 text-[12.5px] text-mist">
            <Loader2 className="size-3.5 animate-spin" /> The engine is working…
          </p>
        )}
        <div ref={end} />
      </div>
      {canAsk && (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line p-3">
          <label htmlFor="say" className="sr-only">
            Message
          </label>
          <textarea
            id="say"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={working ? "The engine is working; you can still add a note." : "Observe, question, decide… (Enter to send)"}
            className={`${inputClass} max-h-40 resize-y`}
          />
          <button type="submit" disabled={busy || !draft.trim() || working} aria-label="Send" className={button("gold", "size-10 shrink-0 p-0")}>
            <ArrowUp className="size-4" />
          </button>
        </form>
      )}
    </Card>
  );
}

function DesignPanel({ d, canAsk, canApprove, busy, siteId, act }: { d: WorkDetail; canAsk: boolean; canApprove: boolean; busy: boolean; siteId: string; act: Act }) {
  const api = browserApi();
  const n = d.work.number;
  const [version, setVersion] = useState<number | null>(null);
  const doc = d.designs.find((x) => x.version === version) ?? d.designs.at(-1);
  const isLatest = doc && doc.version === d.designs.at(-1)?.version;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <FileText className="size-8 text-mist" />
        <p className="max-w-sm text-[13.5px] text-fog">No design yet. Talk it through first; when you agree, the engine writes design.md for you to read, edit and approve.</p>
        {canAsk && (
          <button type="button" className={button("gold")} disabled={busy} onClick={() => act(() => api.work.design(siteId, n, { action: "draft" }), "Drafting the design.")}>
            <PenLine className="size-4" /> Draft the design
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Design version"
          value={doc.version}
          onChange={(e) => {
            setVersion(Number(e.target.value));
            setEditing(false);
          }}
          className="rounded-lg border border-line-2 bg-panel px-2 py-1 text-[12.5px]"
        >
          {[...d.designs].reverse().map((x) => (
            <option key={x.version} value={x.version}>
              v{x.version} · {x.authorLabel}
              {x.approvedAt ? " · approved" : ""}
            </option>
          ))}
        </select>
        {doc.approvedAt ? <Chip tone="good">Approved</Chip> : <Chip tone="warn">Awaiting approval</Chip>}
        <div className="ml-auto flex flex-wrap gap-2">
          {canAsk && isLatest && !editing && (
            <button
              type="button"
              className={button("plain", "text-xs")}
              onClick={() => {
                setText(doc.body);
                setEditing(true);
              }}
            >
              <PenLine className="size-3.5" /> Edit
            </button>
          )}
          {canAsk && isLatest && !editing && (
            <button type="button" className={button("plain", "text-xs")} disabled={busy} onClick={() => act(() => api.work.design(siteId, n, { action: "draft" }), "Revising the design from the conversation.")}>
              <Sparkles className="size-3.5" /> Revise from the conversation
            </button>
          )}
          {canApprove && isLatest && !doc.approvedAt && !editing && (
            <button type="button" className={button("gold", "text-xs")} disabled={busy} onClick={() => act(() => api.work.design(siteId, n, { action: "approve", version: doc.version }), "Design approved.")}>
              <CircleCheck className="size-3.5" /> Approve v{doc.version}
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="grid gap-3 lg:grid-cols-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={28} spellCheck className={`${inputClass} font-mono text-[12.5px] leading-relaxed`} aria-label="design.md" />
            <div className="hidden max-h-[640px] overflow-y-auto rounded-xl border border-line p-3 lg:block">
              <Markdown>{text}</Markdown>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={button("gold")}
              disabled={busy || text.trim() === doc.body.trim()}
              onClick={() =>
                act(async () => {
                  await api.work.design(siteId, n, { action: "save", body: text });
                  setEditing(false);
                  setVersion(null);
                }, "Saved as a new version.")
              }
            >
              Save as v{(d.designs.at(-1)?.version ?? 0) + 1}
            </button>
            <button type="button" className={button("ghost")} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <article className="rounded-xl border border-line bg-panel-2/40 p-4">
          <Markdown>{doc.body}</Markdown>
        </article>
      )}
    </div>
  );
}

function PlanPanel({ d, canAsk, canApprove, busy, siteId, act, next }: { d: WorkDetail; canAsk: boolean; canApprove: boolean; busy: boolean; siteId: string; act: Act; next: WorkStep | null }) {
  const api = browserApi();
  const n = d.work.number;
  const a = d.actions;
  if (!d.steps.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <ListChecks className="size-8 text-mist" />
        <p className="max-w-sm text-[13.5px] text-fog">The plan comes after the design is approved: small, numbered steps, each with the tests that prove it.</p>
        {canAsk && a.draftPlan && (
          <button type="button" className={button("gold")} disabled={busy} onClick={() => act(() => api.work.plan(siteId, n, { action: "draft" }), "Writing the plan.")}>
            <ListChecks className="size-4" /> Write the plan
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {d.work.planApproved ? <Chip tone="good">Plan approved</Chip> : <Chip tone="warn">Awaiting approval</Chip>}
        <div className="ml-auto flex flex-wrap gap-2">
          {canAsk && !d.work.planApproved && (
            <button type="button" className={button("plain", "text-xs")} disabled={busy} onClick={() => act(() => api.work.plan(siteId, n, { action: "draft" }), "Revising the plan from the conversation.")}>
              <Sparkles className="size-3.5" /> Revise from the conversation
            </button>
          )}
          {canApprove && a.approvePlan && (
            <button type="button" className={button("gold", "text-xs")} disabled={busy} onClick={() => act(() => api.work.plan(siteId, n, { action: "approve" }), "Plan approved.")}>
              <CircleCheck className="size-3.5" /> Approve plan
            </button>
          )}
          {canApprove && a.runNextStep && next && (
            <button type="button" className={button("gold", "text-xs")} disabled={busy} onClick={() => act(() => api.work.next(siteId, n), `Building step ${next.position}.`)}>
              <Play className="size-3.5" /> Build step {next.position}
            </button>
          )}
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {d.steps.map((s) => (
          <li key={s.id} className={cx("rounded-xl border px-3.5 py-3", s.status === "blocked" ? "border-bad/40 bg-bad/5" : s.status === "running" ? "border-gold/40 bg-gold/5" : "border-line")}>
            <div className="flex items-start gap-2.5">
              <StepIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {s.position}. {s.title}
                </p>
                {s.detail && <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-fog">{s.detail}</p>}
                {s.evidence.checks && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip tone={s.evidence.checks.typecheck ? "good" : "bad"}>Typecheck {s.evidence.checks.typecheck ? "clean" : "failed"}</Chip>
                    {s.evidence.checks.tests ? (
                      <Chip tone={s.evidence.checks.tests.failed ? "bad" : "good"}>
                        {s.evidence.checks.tests.passed}/{s.evidence.checks.tests.total} tests
                        {s.evidence.checks.testsBefore != null && ` (was ${s.evidence.checks.testsBefore})`}
                      </Chip>
                    ) : (
                      <Chip tone="bad">Tests didn&apos;t run</Chip>
                    )}
                    <Chip tone={s.evidence.checks.touchedTests ? "good" : "warn"}>{s.evidence.checks.touchedTests ? "Tests added/updated" : "No test changes"}</Chip>
                    <EngineerOnly>{s.evidence.commit && <Chip>commit {s.evidence.commit.slice(0, 8)}</Chip>}</EngineerOnly>
                  </div>
                )}
                {!!s.evidence.reasons?.length && (
                  <ul className="mt-2 list-disc pl-5 text-[12.5px] text-bad">
                    {s.evidence.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                <EngineerOnly>
                  {!!s.evidence.files?.length && <p className="mt-2 font-mono text-[11.5px] text-mist">{s.evidence.files.join(" · ")}</p>}
                </EngineerOnly>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const EVENT_CLS = { log: "text-ink", tool: "text-cyan", check: "text-gold-2", status: "text-mist" } as const;

function LogPanel({ d }: { d: WorkDetail }) {
  const job = d.jobs[0];
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [d.events.length]);
  if (!job) return <p className="py-16 text-center text-[13.5px] text-mist">Nothing has run yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Chip tone={job.status === "done" ? "good" : job.status === "failed" ? "bad" : "gold"} className="capitalize">
          {job.status}
        </Chip>
        <span className="text-fog">
          {job.kind.replace("_", " ")} · {modelLabel(job.provider, job.model)}
        </span>
        {job.error && <span className="text-bad">{job.error}</span>}
      </div>
      <div className="rounded-xl border border-line bg-bg/60 p-3 font-mono text-[12px] leading-relaxed">
        {d.events.length === 0 && <p className="text-mist">Waiting for the engine…</p>}
        {d.events.map((e) => (
          <p key={e.id} className={cx("whitespace-pre-wrap break-words", EVENT_CLS[e.kind])}>
            <span className="mr-2 text-mist">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            {e.text}
          </p>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
