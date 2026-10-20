"use client";
import Link from "next/link";
import { timestamp } from "@/lib/format";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  CircleCheck,
  ExternalLink,
  FileText,
  Flag,
  ListChecks,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  PenLine,
  Play,
  Rocket,
  ScrollText,
  Sparkles,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  workClosureCopy,
  decisionAccessReason,
  type AccessVia,
  type Role,
  safeWebUrl,
  WORKSPACE_LENSES,
  type WorkspaceLens,
  artifactCards,
  progressFor,
  readSlash,
  SLASH_HELP,
  type Complexity,
  type InstrumentsResponse,
  type StudioSnapshot,
  type AutoAction,
  canSetComplexity,
  COMPLEXITIES,
  COMPLEXITY_LABEL,
  COMPLEXITY_PROMISE,
  complexityFloor,
  modelLabel,
  RAIL_LABEL,
  type WorkDetail,
  type WorkStep,
} from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { inputClass } from "./action-form";
import { Markdown, StepIcon } from "./flywheel";
import { button, Card, Chip, cx, Eyebrow, PageHeader } from "./ui";
import { EngineerOnly, useUi } from "./ui-provider";

import { CockpitPanel } from "./cockpit/cockpit-panel";
import { LiveCaptions, TalkButton, useVoiceCall, VoiceBar } from "./cockpit/voice-talk";
import { DocDrawer, DocumentCards, WhereWeAre } from "./cockpit/work-sidebar";
import { MandateCard } from "./cockpit/mandate-card";
import { ActivityRibbon } from "./workspace/activity-ribbon";
import { ImprovementReplay } from "./workspace/improvement-replay";
import { MissionControl } from "./workspace/mission-control";
import { ProofLab } from "./workspace/proof-lab";

type Tab = "design" | "plan" | "ship" | "log";


/**
 * One Work item as a cockpit (gen2-crew.md §19, F3d): the conversation in the
 * centre, never away; beside it, where the work stands (sized to its tier),
 * the item's own dial and its documents as cards that open in a drawer. The
 * lenses, replay controls and activity ribbon sit under Details. The page
 * refreshes itself while the crew works.
 */
export function WorkRoom({
  siteId,
  initial,
  initialStudio,
  access,
  canAsk,
  canApprove,
  canShip,
  instruments,
}: {
  siteId: string;
  initial: WorkDetail;
  initialStudio: StudioSnapshot;
  /** The item's own Cockpit Dial readings (null when they couldn't be read). */
  instruments: InstrumentsResponse | null;
  access: { via: AccessVia; role: Role };
  canAsk: boolean;
  canApprove: boolean;
  canShip: boolean;
}) {
  const [d, setD] = useState(initial);
  const [studio, setStudio] = useState(initialStudio);
  const [lens, setLens] = useState<WorkspaceLens>("studio");
  const [replayOpen, setReplayOpen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refreshing = useRef(false);
  const [drawer, setDrawer] = useState<Tab | null>(null);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const n = d.work.number;
  const api = browserApi();

  const job = d.jobs[0];
  const working =
    !!job && (job.status === "queued" || job.status === "running");

  const refresh = useCallback(async () => {
    if (
      refreshing.current ||
      document.hidden ||
      initialStudio.source === "sample"
    )
      return;
    refreshing.current = true;
    try {
      const result = await browserApi().work.studio(siteId, n);
      setD(result.detail);
      setStudio(result.studio);
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    } finally {
      refreshing.current = false;
    }
  }, [siteId, n, initialStudio.source]);

  // Pushed updates (gen2-crew.md §17 F4): refresh the moment the item changes; a slow poll is the safety net.
  useEffect(() => {
    if (initialStudio.source === "sample") return;
    const ctrl = new AbortController();
    void browserApi().work.watch(siteId, n, () => void refresh(), ctrl.signal);
    const slow = setInterval(refresh, 30_000);
    return () => {
      ctrl.abort();
      clearInterval(slow);
    };
  }, [refresh, siteId, n, initialStudio.source]);


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
  const closed = d.work.stage === "done" || d.work.stage === "cancelled";
  const closure = workClosureCopy(d.work);
  const gate = a.approveDesign
    ? "design"
    : a.approvePlan
      ? "plan"
      : a.approveTry
        ? "try"
        : a.release
          ? "release"
          : a.runNextStep || a.prove || a.close
            ? "execute"
            : null;
  const decisionNotice =
    gate && studio.source !== "sample"
      ? decisionAccessReason({ ...access, risk: d.work.risk, gate })
      : null;
  const mayApproveTry = !decisionAccessReason({
    ...access,
    risk: d.work.risk,
    gate: "try",
  });

  return (
    <>
      <PageHeader
        title={`#${n} ${d.work.title}`}
        sub="Delivery Studio · business intent, expert work and proof"
      >
        <RunnerBadge online={d.runnerOnline} />
        {d.work.kind === "change" &&
          ((canAsk && d.actions.cancel) || (canApprove && d.actions.close)) && (
            <button
              type="button"
              className={button("ghost", "text-xs")}
              disabled={busy}
              onClick={() => {
                if (window.confirm(closure.confirmation))
                  void act(
                    () => api.work.ship(siteId, n, closure.action),
                    closure.success,
                  );
              }}
            >
              <XCircle className="size-3.5" /> {closure.label}
            </button>
          )}
        {canAsk && (
          <Link
            href={`/s/${encodeURIComponent(siteId)}/work`}
            className={button("plain")}
          >
            Start another improvement
          </Link>
        )}
      </PageHeader>

      <div className="flex flex-col gap-4 px-6 pb-16 pt-5 lg:px-8">
        {studio.source === "sample" && (
          <p
            role="status"
            className="rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm text-warn"
          >
            Illustrative workspace · synthetic conversation, jobs, models and
            checks. No site was changed. Execution and approval controls are
            disabled.
          </p>
        )}
        {refreshError && (
          <p
            role="alert"
            className="rounded-xl border border-warn/30 p-3 text-sm text-warn"
          >
            Updates could not be loaded. Showing the last received records;
            current state is unknown. Automatic refresh will retry.
          </p>
        )}
        <section className="rounded-2xl border border-violet/30 bg-gradient-to-r from-violet/10 via-panel to-cyan/5 px-5 py-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <Eyebrow>What you intended. What you approved. Delivered.</Eyebrow>
              <p className="mt-2 max-w-4xl text-[15px] leading-relaxed">{studio.summary}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={button("plain")} onClick={() => setReplayOpen(true)}>
                <Play className="size-4" /> Replay this improvement
              </button>
              <button type="button" className={button("ghost")} aria-expanded={details} onClick={() => setDetails((v) => !v)}>
                {details ? "Hide details" : "Details"}
              </button>
            </div>
          </div>
          {details && (
            <div className="mt-4 flex flex-col gap-3 border-t border-line/70 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <nav className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg/40 p-1" aria-label="Workspace lens">
                  {WORKSPACE_LENSES.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={lens === l.id}
                      title={l.description}
                      onClick={() => setLens(l.id)}
                      className={button(lens === l.id ? "gold" : "ghost")}
                    >
                      {l.title}
                    </button>
                  ))}
                </nav>
                <button type="button" className={button("ghost")} aria-pressed={motionPaused} onClick={() => setMotionPaused((p) => !p)}>
                  {motionPaused ? "Resume visual motion" : "Pause visual motion"}
                </button>
              </div>
              <ActivityRibbon studio={studio} paused={motionPaused} />
              <p className="text-xs text-mist">
                Last received {timestamp(studio.observedAt)} · switching lenses changes presentation, never permissions.
              </p>
            </div>
          )}
        </section>
        {decisionNotice && (
          <section
            role="status"
            aria-label="Decision access"
            className="rounded-xl border border-warn/40 bg-warn/5 p-4"
          >
            <h2 className="font-semibold text-warn">
              Awaiting an authorized client decision
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fog">
              {decisionNotice}
            </p>
            <p className="mt-2 text-xs text-mist">
              Current account access: {access.via} · {access.role}. Changing
              workspace lenses does not change authority.
            </p>
          </section>
        )}
        {closed && (
          <section
            role="status"
            className="rounded-xl border border-line-2 bg-panel p-4"
          >
            <h2 className="font-semibold">This body of work is closed</h2>
            <p className="mt-2 text-sm text-fog">
              {d.work.stage === "cancelled"
                ? "Closed without a recorded platform release. Existing code and previews have not been undone. This is not counted as a verified platform delivery."
                : "Its recorded release evidence remains in the history."}{" "}
              Start another improvement for new scope and approvals.
            </p>
          </section>
        )}
        {replayOpen && (
          <ImprovementReplay
            studio={studio}
            close={() => setReplayOpen(false)}
          />
        )}
        {lens === "mission" && (
          <MissionControl
            studio={studio}
            inspect={(target) => {
              setLens("studio");
              setDrawer(target);
            }}
          />
        )}
        {lens === "proof" && <ProofLab studio={studio} />}
        <div hidden={lens !== "studio"} className="flex flex-col gap-4">
          {install && (
            <p className="text-[13px] text-fog">
              The installation conversation: ask the engine about anything on the Setup page. It sees the checklist, the checkout log and which keys
              are set (never their values), and can read the code.
            </p>
          )}

          {d.work.kind === "change" && !closed && (
            <ComplexityControl d={d} canSet={canApprove && studio.source !== "sample" && !d.work.released} busy={busy} act={act} siteId={siteId} />
          )}

          {/* The cockpit: the conversation in the centre, where the work is beside it. */}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
            <Thread
              d={d}
              working={working}
              canAsk={canAsk && !closed}
              busy={busy}
              onTier={(c) => act(() => api.work.complexity(siteId, n, c), `Complexity set to ${c}.`)}
              onOpen={setDrawer}
              siteId={siteId}
              voice={canAsk && !closed && !install}
              onChanged={() => refresh()}
              onPause={!closed && d.work.kind === "change" && canAsk ? () => act(() => api.work.ship(siteId, n, d.work.paused ? "resume" : "pause"), d.work.paused ? "The crew resumed." : "The crew is paused.") : undefined}
              card={
                studio.source !== "sample" && (
                  <NeedsYou
                    d={d}
                    canAsk={canAsk && !closed}
                    working={working}
                    canApprove={canApprove && !closed}
                    canShip={canShip}
                    mayApproveTry={mayApproveTry}
                    busy={busy}
                    onTab={setDrawer}
                    act={act}
                    siteId={siteId}
                  />
                )
              }
            />
            <aside aria-label="Where the work stands" className="flex flex-col gap-4">
              {!install && <WhereWeAre milestones={progressFor(d)} complexity={d.work.complexity} />}
              {!install && studio.source !== "sample" && (
                <MandateCard siteId={siteId} d={d} canEdit={canApprove && access.via === "member" && !closed} onSaved={refresh} />
              )}
              {!install && instruments && <CockpitPanel siteId={siteId} number={n} initial={instruments} compact />}
              <DocumentCards cards={install ? artifactCards(d).filter((c) => c.id === "log") : artifactCards(d)} onOpen={setDrawer} />
            </aside>
          </div>
        </div>
        {drawer && (
          <DocDrawer
            title={drawer === "design" ? `${d.work.complexity === "medium" ? "Brief" : "Design"}${latest ? ` v${latest.version}` : ""}` : drawer === "plan" ? "Plan" : drawer === "ship" ? "Proof and release" : "Live log"}
            onClose={() => setDrawer(null)}
          >
            {drawer === "design" && (
              <DesignPanel d={d} canAsk={canAsk && !closed && d.actions.draftDesign} canApprove={canApprove && !closed} busy={busy || working} siteId={siteId} act={act} />
            )}
            {drawer === "plan" && <PlanPanel d={d} canAsk={canAsk && !closed} canApprove={canApprove && !closed} busy={busy || working} siteId={siteId} act={act} next={next} />}
            {drawer === "ship" && <ShipPanel d={d} />}
            {drawer === "log" && <LogPanel d={d} />}
          </DocDrawer>
        )}
      </div>
    </>
  );
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

/** What the engine is doing, in plain words. */
const JOB_DOING: Record<string, string> = {
  build_step: "building a step, with its tests",
  discuss: "replying",
  design: "writing it up",
  plan: "planning the steps",
  prove: "proving it: every check, then the push and the preview",
  release: "releasing: stage, main, production, then the live check",
};

/** What the crew does next on its own (gen2-crew.md §17), for when it's waiting to start. */
const CREW_NEXT: Record<AutoAction, string> = {
  begin: "start building",
  design: "draft it up for you",
  plan: "plan the steps",
  approve_plan: "take its plan and start building",
  build_step: "build the next step",
  repair_step: "fix the step that didn't pass its checks",
  prove: "prove it and open a preview",
  repair_proof: "fix what Prove found and prove again",
  ship: "ship it, now that every check passed",
};

/**
 * The one thing that needs a person, if anything (gen2-crew.md §17). Low has
 * no decisions; Medium has the Brief and Ship it; High keeps design, plan, Try
 * and Go live. Everything else the crew does on its own.
 */
function NeedsYou({
  d,
  canAsk,
  working,
  canApprove,
  canShip,
  mayApproveTry,
  busy,
  onTab,
  act,
  siteId,
}: {
  d: WorkDetail;
  canAsk: boolean;
  working: boolean;
  canApprove: boolean;
  canShip: boolean;
  mayApproveTry: boolean;
  busy: boolean;
  onTab: (t: Tab) => void;
  act: Act;
  siteId: string;
}) {
  const a = d.actions;
  const api = browserApi();
  const n = d.work.number;
  const tier = d.work.complexity;
  const latest = d.designs.at(-1);
  const blocked = d.steps.find((s) => s.status === "blocked");
  const doneCount = d.steps.filter((s) => s.status === "done").length;
  const job = d.jobs[0];
  const brief = tier === "medium" ? "Brief" : "design";

  // Owner-gated decisions: the button plus a confirmation that names the risk (gen2-crew.md §17.4).
  const confirmRisk = d.decision?.ownerOnly ? `${d.decision.title}: this touches ${d.work.risk.join(", ")}. Go ahead?` : null;
  const go = (label: string, run: () => Promise<unknown>, done: string, Icon = CircleCheck, tone: "gold" | "plain" = "gold") => (
    <button
      type="button"
      className={button(tone)}
      disabled={busy}
      onClick={() => {
        if (tone === "gold" && confirmRisk && !window.confirm(confirmRisk)) return;
        void act(run, done);
      }}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
  const preview = safeWebUrl(d.work.previewUrl) && (
    <a href={safeWebUrl(d.work.previewUrl)!} target="_blank" rel="noreferrer" className={button("plain")}>
      <ExternalLink className="size-4" /> Open preview
    </a>
  );

  let text: string | null = null;
  let action: React.ReactNode = null;
  let needsYou = true;
  if (working) {
    needsYou = false;
    const steps = job!.kind === "build_step" && d.steps.length > 1 ? ` (step ${Math.min(doneCount + 1, d.steps.length)} of ${d.steps.length})` : "";
    text = `The crew is ${JOB_DOING[job!.kind] ?? `writing the ${job!.kind}`}${steps} · ${modelLabel(job!.provider, job!.model)}.`;
    action = <Loader2 className="size-4 animate-spin text-gold-2" />;
  } else if (!d.runnerOnline) {
    text = "The engine is offline. Start the runner and the crew picks up where things are.";
  } else if (d.work.kind === "install") {
    return null;
  } else if (d.work.paused) {
    text = "The crew is paused. Nothing new starts until you resume (or type resume).";
  } else if (d.crewNext) {
    needsYou = false;
    text = `Next, the crew will ${CREW_NEXT[d.crewNext]}.`;
  } else if (a.approveDesign && latest) {
    text =
      tier === "medium"
        ? `The Brief (v${latest.version}) is ready. Approve it and the crew plans, builds and proves it on its own; you'll only decide to ship.`
        : `Design v${latest.version} is ready. Read it, edit it, or ask for changes in the conversation.`;
    action = canApprove
      ? go(`Approve the ${brief}`, () => api.work.design(siteId, n, { action: "approve", version: latest.version }), `${tier === "medium" ? "Brief" : "Design"} approved.`)
      : (
        <button type="button" className={button("plain")} onClick={() => onTab("design")}>
          Read the {brief}
        </button>
      );
  } else if (a.approvePlan) {
    text = `The plan has ${d.steps.length} steps. Approve it and the crew builds them on its own.`;
    action = canApprove ? go("Approve plan", () => api.work.plan(siteId, n, { action: "approve" }), "Plan approved.") : null;
  } else if (a.runNextStep && blocked) {
    text = `Step ${blocked.position} still doesn't pass its checks after ${blocked.attempts} runs: ${blocked.evidence.reasons?.join(" ") || "see the live log"} Tell the lead what you want, or run it again.`;
    action = canApprove ? go(`Run step ${blocked.position} again`, () => api.work.next(siteId, n), `Running step ${blocked.position} again.`, Play) : null;
  } else if (a.prove) {
    text = `Prove still doesn't pass after the crew's fix: ${d.work.proof?.reasons[0] ?? "see the evidence"} Tell the lead what you want, or prove again.`;
    action = canApprove ? go("Prove again", () => api.work.ship(siteId, n, "prove"), "Proving: checks, push, preview.", Rocket) : null;
  } else if (a.ship) {
    text = "Every check passed and the preview is up. Try it, then Ship it, or tell the lead what to change.";
    action = (
      <>
        {preview}
        {canApprove && canShip && mayApproveTry && go("Ship it", () => api.work.ship(siteId, n, "ship"), "Shipping: stage, main, production, live check.", Rocket)}
      </>
    );
  } else if (a.approveTry) {
    text = "The preview is up. Try it with real clicks, then approve it for release, or tell the lead what to change.";
    action = (
      <>
        {preview}
        {canApprove && mayApproveTry && go("Approve for release", () => api.work.ship(siteId, n, "approve"), "Approved for release.")}
      </>
    );
  } else if (a.release) {
    const failed = d.work.release && !d.work.release.ok && !d.work.released;
    text = failed
      ? `The release didn't finish: ${d.work.release!.reasons[0] ?? "see the evidence"} Try again when it's fixed.`
      : "Approved. Go live merges this into stage and main, waits for production, and checks the live site.";
    action = canShip ? go(failed ? "Release again" : "Go live", () => api.work.ship(siteId, n, "release"), "Releasing to production.", Rocket) : null;
  } else if (a.close) {
    const r = d.work.release;
    text = r?.ok
      ? `Live: ${r.liveUrl} answers ${r.liveStatus}. Note anything you learned in the conversation, then close #${n}.`
      : `Released to main, but the live check needs a look: ${r?.reasons[0] ?? "see the evidence"}`;
    action = canApprove ? go(`Close #${n}`, () => api.work.ship(siteId, n, "close"), `#${n} closed.`, Flag, "plain") : null;
  } else if (a.begin && canAsk) {
    text = "Low complexity: the crew builds, proves and ships this on its own once the lead has what it needs. Start now?";
    action = go("Start now", () => api.work.ship(siteId, n, "begin"), "The crew is starting.", Play, "plain");
  } else if (a.draftDesign && canAsk && d.work.stage === "discuss" && d.messages.length > 1) {
    text = `When you and the lead agree, the crew drafts the ${brief}. It starts on its own once the lead says it's ready.`;
    action = go(`Draft the ${brief} now`, () => api.work.design(siteId, n, { action: "draft" }), `Drafting the ${brief}.`, PenLine, "plain");
  }

  if (!text) return null;
  const pd = needsYou ? d.decision : null;
  return (
    <div
      role={needsYou ? "group" : "status"}
      aria-label={needsYou ? (pd?.title ?? "Needs you") : "What the crew is doing"}
      className={cx(
        "flex flex-col gap-2.5 rounded-2xl border px-4 py-3",
        needsYou ? "border-gold/35 bg-gold/[0.07]" : "border-line bg-panel-2/60",
      )}
    >
      <p className="flex items-start gap-2 text-[13.5px]">
        <Sparkles className={cx("mt-0.5 size-4 shrink-0", needsYou ? "text-gold-2" : "text-mist")} />
        <span className="min-w-0 flex-1">
          <span className={cx("font-semibold", needsYou ? "text-gold-2" : "text-fog")}>{pd ? `${pd.title} · ` : needsYou ? "Needs you · " : "Crew · "}</span>
          {text}
        </span>
      </p>
      {(action || pd) && (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {pd && (
            <span className="text-[12px] text-mist">
              {pd.ownerOnly ? "Button only: this touches money, data, sign-in or security." : `or type "${pd.kind === "ship" ? "ship it" : "approve"}"`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** The complexity tier: the platform's recommendation, and the person's choice at or above the floor. */
function ComplexityControl({ d, canSet, busy, act, siteId }: { d: WorkDetail; canSet: boolean; busy: boolean; act: Act; siteId: string }) {
  const api = browserApi();
  const w = d.work;
  const floor = complexityFloor(w.risk);
  const rec = w.recommendedComplexity;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Complexity" className="flex rounded-lg border border-line-2 bg-panel p-0.5 text-[12.5px]">
        {COMPLEXITIES.map((c) => {
          const allowed = canSet && canSetComplexity(c, w.risk);
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={w.complexity === c}
              disabled={!allowed || busy || w.complexity === c}
              title={`${COMPLEXITY_LABEL[c]}: ${COMPLEXITY_PROMISE[c]}${!canSetComplexity(c, w.risk) ? ` Not available: this touches ${w.risk.join(", ")}.` : ""}`}
              onClick={() => act(() => api.work.complexity(siteId, w.number, c), `Complexity set to ${COMPLEXITY_LABEL[c]}.`)}
              className={cx(
                "rounded-md px-2.5 py-1",
                w.complexity === c ? "bg-gold/15 font-semibold text-ink" : "text-fog enabled:hover:text-ink disabled:opacity-40",
              )}
            >
              {COMPLEXITY_LABEL[c]}
              {rec === c && <span className="ml-1 text-[10.5px] text-mist">rec.</span>}
            </button>
          );
        })}
      </div>
      {w.complexity === "medium" && canSet && (
        <label className="flex items-center gap-1.5 text-[12.5px] text-fog" title="Off by default. Never available on High.">
          <input
            type="checkbox"
            checked={w.autoShip}
            disabled={busy}
            onChange={(e) => act(() => api.work.autoShip(siteId, w.number, e.target.checked), e.target.checked ? "Ships automatically when green." : "Automatic shipping off.")}
          />
          Ship automatically when green
        </label>
      )}
      <span className="text-[12px] text-mist">
        {COMPLEXITY_PROMISE[w.complexity]}
        {w.complexityReason ? ` ${w.complexityReason}` : ""}
        {floor === "high" ? " Protected risk keeps it High." : ""}
      </span>
    </div>
  );
}

/**
 * The conversation: every message, then the one card that needs a person (or
 * what the crew is doing), then the composer. Decisions can be answered by
 * their button or by typing "approve"; "stop" pauses the crew (gen2-crew.md §17.4).
 */
function Thread({
  d,
  working,
  canAsk,
  busy,
  onPause,
  onTier,
  onOpen,
  card,
  siteId,
  voice,
  onChanged,
}: {
  d: WorkDetail;
  working: boolean;
  canAsk: boolean;
  busy: boolean;
  onPause?: () => void;
  onTier: (c: Complexity) => Promise<void>;
  onOpen: (panel: Tab) => void;
  card?: React.ReactNode;
  siteId: string;
  /** Live voice is offered on this item (gen2-crew.md §19.1). */
  voice: boolean;
  /** The work changed (a voice tool ran, a call ended, a reply finished): refresh. */
  onChanged: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  // The message just sent and the lead's reply as it streams in (gen2-crew.md §17 F4).
  const [live, setLive] = useState<{ said: string; reply: string; note: string | null; streaming: boolean } | null>(null);
  const [hint, setHint] = useState<"help" | string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const call = useVoiceCall({ siteId, number: d.work.number, onChanged });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [d.messages.length, d.decision?.key, d.crewNext, working, call.captions, live?.reply, hint]);
  // Escape leaves the full-screen conversation.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || live?.streaming) return;
    setDraft("");
    setHint(null);
    // Slash commands: shortcuts for what the buttons do (§17 F5); /ship and /approve are the typed decision.
    const slash = readSlash(body);
    if (slash) {
      if (slash.kind === "help") return setHint("help");
      if (slash.kind === "unknown") return setHint(`"${slash.text}" isn't a command. Type /help for the list.`);
      if (slash.kind === "pause" || slash.kind === "resume") {
        if ((slash.kind === "pause") !== d.work.paused) onPause?.();
        return;
      }
      if (slash.kind === "tier") return void (await onTier(slash.complexity));
      if (slash.kind === "open") return onOpen(slash.panel);
      if (slash.kind === "talk") return void (voice ? call.start() : setHint("Live voice isn't available on this item."));
      return void (await say(slash.body));
    }
    await say(body);
  }

  /** Sends a message and streams the lead's answer in place, then refreshes from the record. */
  async function say(body: string) {
    setLive({ said: body, reply: "", note: null, streaming: true });
    try {
      await browserApi().work.sayStream(siteId, d.work.number, body, d.decision?.key, (e) => {
        if (e.type === "delta") setLive((l) => (l ? { ...l, reply: l.reply + e.text } : l));
        else if (e.type === "handled" || e.type === "queued") setLive((l) => (l ? { ...l, note: e.note } : l));
        else if (e.type === "error") setLive((l) => (l ? { ...l, note: e.message } : l));
      });
    } catch (err) {
      setLive((l) => (l ? { ...l, note: err instanceof Error ? err.message : "That didn't send." } : l));
    }
    setLive((l) => (l ? { ...l, streaming: false } : l));
    await onChanged();
    setLive(null);
  }

  return (
    <>
    {expanded && <div aria-hidden className="fixed inset-0 z-30 bg-bg/80 backdrop-blur-sm" onClick={() => setExpanded(false)} />}
    <Card className={cx("flex flex-col", expanded ? "fixed inset-3 z-40 shadow-2xl sm:inset-6" : "max-h-[78vh] min-h-[520px]")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="flex items-center gap-2">
          <Eyebrow>Conversation</Eyebrow>
          {voice && <TalkButton call={call} />}
        </span>
        <span className="flex items-center gap-2 text-[12px] text-mist">
          Lead: {modelLabel(d.models.consult.provider, d.models.consult.model)}
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            aria-pressed={expanded}
            aria-label={expanded ? "Leave full screen" : "Full screen"}
            title={expanded ? "Leave full screen (Esc)" : "Full screen"}
            className={button("ghost", "size-8 p-0")}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          {onPause && (
            <button
              type="button"
              onClick={onPause}
              disabled={busy}
              aria-pressed={d.work.paused}
              title={d.work.paused ? "Let the crew carry on" : "Stop the crew starting anything new (or type stop)"}
              className={button(d.work.paused ? "gold" : "ghost", "text-xs")}
            >
              {d.work.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {d.work.paused ? "Resume crew" : "Pause crew"}
            </button>
          )}
        </span>
      </div>
      <VoiceBar call={call} />
      <div className={cx("flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4", expanded && "mx-auto w-full max-w-4xl")}>
        {d.messages.map((m) =>
          m.authorKind === "system" ? (
            <p
              key={m.id}
              className="self-center rounded-full bg-panel-2 px-3 py-1 text-center text-[12px] text-mist"
            >
              {m.body}
            </p>
          ) : (
            <div
              key={m.id}
              className={cx(
                "flex gap-2.5",
                m.authorKind === "person" && "flex-row-reverse",
              )}
            >
              <span
                className={cx(
                  "grid size-7 shrink-0 place-items-center rounded-full",
                  m.authorKind === "person"
                    ? "bg-violet/20 text-violet"
                    : "bg-gold/15 text-gold-2",
                )}
              >
                {m.authorKind === "person" ? (
                  <User className="size-3.5" />
                ) : (
                  <Bot className="size-3.5" />
                )}
              </span>
              <div
                className={cx(
                  "max-w-[88%] rounded-2xl px-3.5 py-2.5",
                  m.authorKind === "person"
                    ? "rounded-tr-md bg-violet/12"
                    : "rounded-tl-md bg-panel-2",
                )}
              >
                <p className="mb-1 text-[11.5px] text-mist">
                  {m.authorLabel} ·{" "}
                  {RAIL_LABEL[m.stage as keyof typeof RAIL_LABEL] ?? m.stage}
                </p>
                {m.authorKind === "model" ? (
                  <Markdown>{m.body}</Markdown>
                ) : (
                  <p className="whitespace-pre-wrap text-[13.5px]">{m.body}</p>
                )}
              </div>
            </div>
          ),
        )}
        {live && (
          <>
            <div className="flex flex-row-reverse gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-violet/20 text-violet">
                <User className="size-3.5" />
              </span>
              <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-violet/12 px-3.5 py-2.5 text-[13.5px]">{live.said}</p>
            </div>
            {(live.reply || (live.streaming && !live.note)) && (
              <div className="flex gap-2.5" aria-live="polite">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold/15 text-gold-2">
                  <Bot className="size-3.5" />
                </span>
                <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-panel-2 px-3.5 py-2.5">
                  <p className="mb-1 text-[11.5px] text-mist">Team Lead · {live.streaming ? "replying" : "replied"}</p>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                    {live.reply || "…"}
                    {live.streaming && <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-current/60 motion-safe:animate-pulse" />}
                  </p>
                </div>
              </div>
            )}
            {live.note && <p className="self-center rounded-full bg-panel-2 px-3 py-1 text-center text-[12px] text-mist">{live.note}</p>}
          </>
        )}
        {hint && (
          <div role="status" className="rounded-2xl border border-line bg-panel-2/60 px-4 py-3 text-[12.5px] text-fog">
            {hint === "help" ? (
              <ul className="flex flex-col gap-1">
                {SLASH_HELP.map((h) => (
                  <li key={h.command}>
                    <span className="font-mono text-ink">{h.command}</span> · {h.does}
                  </li>
                ))}
              </ul>
            ) : (
              hint
            )}
          </div>
        )}
        {card}
        <LiveCaptions captions={call.captions} person="You" />
        <div ref={end} />
      </div>
      {canAsk && (
        <form
          onSubmit={send}
          className="flex items-end gap-2 border-t border-line p-3"
        >
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
            placeholder={
              d.decision && !d.decision.ownerOnly
                ? `Ask, or type "approve" for: ${d.decision.title}`
                : working
                  ? "The crew is working; you can still talk (or type stop)."
                  : "Observe, question, decide… (/ for commands)"
            }
            className={`${inputClass} max-h-40 resize-y`}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim() || !!live?.streaming}
            aria-label="Send"
            className={button("gold", "size-10 shrink-0 p-0")}
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
      )}
    </Card>
    </>
  );
}

function DesignPanel({
  d,
  canAsk,
  canApprove,
  busy,
  siteId,
  act,
}: {
  d: WorkDetail;
  canAsk: boolean;
  canApprove: boolean;
  busy: boolean;
  siteId: string;
  act: Act;
}) {
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
        <p className="max-w-sm text-[13.5px] text-fog">
          No design yet. Talk it through first; when you agree, the engine
          writes design.md for you to read, edit and approve.
        </p>
        {canAsk && (
          <button
            type="button"
            className={button("gold")}
            disabled={busy}
            onClick={() =>
              act(
                () => api.work.design(siteId, n, { action: "draft" }),
                "Drafting the design.",
              )
            }
          >
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
        {doc.approvedAt ? (
          <Chip tone="good">Approved</Chip>
        ) : (
          <Chip tone="warn">Awaiting approval</Chip>
        )}
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
            <button
              type="button"
              className={button("plain", "text-xs")}
              disabled={busy}
              onClick={() =>
                act(
                  () => api.work.design(siteId, n, { action: "draft" }),
                  "Revising the design from the conversation.",
                )
              }
            >
              <Sparkles className="size-3.5" /> Revise from the conversation
            </button>
          )}
          {canApprove && isLatest && !doc.approvedAt && !editing && (
            <button
              type="button"
              className={button("gold", "text-xs")}
              disabled={busy}
              onClick={() =>
                act(
                  () =>
                    api.work.design(siteId, n, {
                      action: "approve",
                      version: doc.version,
                    }),
                  "Design approved.",
                )
              }
            >
              <CircleCheck className="size-3.5" /> Approve v{doc.version}
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="grid gap-3 lg:grid-cols-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={28}
              spellCheck
              className={`${inputClass} font-mono text-[12.5px] leading-relaxed`}
              aria-label="design.md"
            />
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
                  await api.work.design(siteId, n, {
                    action: "save",
                    body: text,
                  });
                  setEditing(false);
                  setVersion(null);
                }, "Saved as a new version.")
              }
            >
              Save as v{(d.designs.at(-1)?.version ?? 0) + 1}
            </button>
            <button
              type="button"
              className={button("ghost")}
              onClick={() => setEditing(false)}
            >
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

function PlanPanel({
  d,
  canAsk,
  canApprove,
  busy,
  siteId,
  act,
  next,
}: {
  d: WorkDetail;
  canAsk: boolean;
  canApprove: boolean;
  busy: boolean;
  siteId: string;
  act: Act;
  next: WorkStep | null;
}) {
  const api = browserApi();
  const n = d.work.number;
  const a = d.actions;
  if (!d.steps.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <ListChecks className="size-8 text-mist" />
        <p className="max-w-sm text-[13.5px] text-fog">
          {d.work.complexity === "low"
            ? "Low complexity: one step, built straight from the conversation, with the tests that prove it."
            : "The plan comes after the Brief or design is approved: small, numbered steps, each with the tests that prove it."}
        </p>
        {canAsk && a.draftPlan && (
          <button
            type="button"
            className={button("gold")}
            disabled={busy}
            onClick={() =>
              act(
                () => api.work.plan(siteId, n, { action: "draft" }),
                "Writing the plan.",
              )
            }
          >
            <ListChecks className="size-4" /> Write the plan
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {d.work.complexity !== "high" ? (
          <Chip tone="good">The crew&apos;s plan</Chip>
        ) : d.work.planApproved ? (
          <Chip tone="good">Plan approved</Chip>
        ) : (
          <Chip tone="warn">Awaiting approval</Chip>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canAsk && a.draftPlan && !d.work.planApproved && (
            <button
              type="button"
              className={button("plain", "text-xs")}
              disabled={busy}
              onClick={() =>
                act(
                  () => api.work.plan(siteId, n, { action: "draft" }),
                  "Revising the plan from the conversation.",
                )
              }
            >
              <Sparkles className="size-3.5" /> Revise from the conversation
            </button>
          )}
          {canApprove && a.approvePlan && (
            <button
              type="button"
              className={button("gold", "text-xs")}
              disabled={busy}
              onClick={() =>
                act(
                  () => api.work.plan(siteId, n, { action: "approve" }),
                  "Plan approved.",
                )
              }
            >
              <CircleCheck className="size-3.5" /> Approve plan
            </button>
          )}
          {canApprove && a.runNextStep && next && (
            <button
              type="button"
              className={button("gold", "text-xs")}
              disabled={busy}
              onClick={() =>
                act(
                  () => api.work.next(siteId, n),
                  `Running step ${next.position} again.`,
                )
              }
            >
              <Play className="size-3.5" /> Run step {next.position} again
            </button>
          )}
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {d.steps.map((s) => (
          <li
            key={s.id}
            className={cx(
              "rounded-xl border px-3.5 py-3",
              s.status === "blocked"
                ? "border-bad/40 bg-bad/5"
                : s.status === "running"
                  ? "border-gold/40 bg-gold/5"
                  : "border-line",
            )}
          >
            <div className="flex items-start gap-2.5">
              <StepIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">
                  {s.position}. {s.title}
                </p>
                {s.detail && (
                  <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-fog">
                    {s.detail}
                  </p>
                )}
                {s.evidence.checks && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip tone={s.evidence.checks.typecheck ? "good" : "bad"}>
                      Typecheck{" "}
                      {s.evidence.checks.typecheck ? "clean" : "failed"}
                    </Chip>
                    {s.evidence.checks.tests ? (
                      <Chip
                        tone={s.evidence.checks.tests.failed ? "bad" : "good"}
                      >
                        {s.evidence.checks.tests.passed}/
                        {s.evidence.checks.tests.total} tests
                        {s.evidence.checks.testsBefore != null &&
                          ` (was ${s.evidence.checks.testsBefore})`}
                      </Chip>
                    ) : (
                      <Chip tone="bad">Tests didn&apos;t run</Chip>
                    )}
                    <Chip
                      tone={s.evidence.checks.touchedTests ? "good" : "warn"}
                    >
                      {s.evidence.checks.touchedTests
                        ? "Tests added/updated"
                        : "No test changes"}
                    </Chip>
                    <EngineerOnly>
                      {s.evidence.commit && (
                        <Chip>commit {s.evidence.commit.slice(0, 8)}</Chip>
                      )}
                    </EngineerOnly>
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
                  {!!s.evidence.files?.length && (
                    <p className="mt-2 font-mono text-[11.5px] text-mist">
                      {s.evidence.files.join(" · ")}
                    </p>
                  )}
                </EngineerOnly>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Prove, Try and Release evidence: what was checked, where the preview is, what went live. */
function ShipPanel({ d }: { d: WorkDetail }) {
  const { proof, release, previewUrl, tryApproved } = d.work;
  if (!proof && !release) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <Rocket className="size-8 text-mist" />
        <p className="max-w-sm text-[13.5px] text-fog">
          Once every step is built, Prove runs every check, pushes the branch
          and opens a preview for you to try. Then Go live releases it and
          checks the live site.
        </p>
      </div>
    );
  }
  const guarded = proof?.previewStatus === 401 || proof?.previewStatus === 403;
  return (
    <div className="flex flex-col gap-4">
      {proof && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Prove</Eyebrow>
            <Chip tone={proof.ok ? "good" : "bad"}>
              {proof.ok ? "Passed" : "Didn't pass"}
            </Chip>
            <span className="text-[12px] text-mist">
              {new Date(proof.at).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone={proof.typecheck ? "good" : "bad"}>
              Typecheck {proof.typecheck ? "clean" : "failed"}
            </Chip>
            {proof.tests ? (
              <Chip tone={proof.tests.failed ? "bad" : "good"}>
                {proof.tests.passed}/{proof.tests.total} tests
              </Chip>
            ) : (
              <Chip tone="bad">Tests didn&apos;t run</Chip>
            )}
            {proof.build != null && (
              <Chip tone={proof.build ? "good" : "bad"}>
                Build {proof.build ? "ok" : "failed"}
              </Chip>
            )}
            <Chip
              tone={
                proof.previewState === "success"
                  ? "good"
                  : proof.previewState === "skipped"
                    ? "warn"
                    : "bad"
              }
            >
              Preview {proof.previewState}
            </Chip>
            <EngineerOnly>
              {proof.commit && (
                <Chip>
                  {proof.branch} @ {proof.commit.slice(0, 8)}
                </Chip>
              )}
            </EngineerOnly>
          </div>
          {!!proof.reasons.length && (
            <ul className="list-disc pl-5 text-[12.5px] text-bad">
              {proof.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {previewUrl && (
        <section className="flex flex-col gap-2 rounded-xl border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Try</Eyebrow>
            <Chip tone={tryApproved ? "good" : "warn"}>
              {tryApproved ? "Approved for release" : "Waiting for you"}
            </Chip>
          </div>
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 break-all text-[13px] text-cyan hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" /> {previewUrl}
          </a>
          {guarded && (
            <p className="text-[12.5px] text-fog">
              The preview is behind Vercel&apos;s protection: sign in to Vercel
              in this browser to open it.
            </p>
          )}
          <p className="text-[12.5px] text-fog">
            Try what the design promised, the way a customer would. If
            something&apos;s off, say so in the conversation instead of
            approving.
          </p>
        </section>
      )}

      {release && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Release</Eyebrow>
            <Chip
              tone={release.ok ? "good" : release.mainCommit ? "warn" : "bad"}
            >
              {release.ok
                ? "Live and checked"
                : release.mainCommit
                  ? "Released; check needed"
                  : "Not released"}
            </Chip>
            <span className="text-[12px] text-mist">
              {new Date(release.at).toLocaleString()}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip tone={release.productionState === "success" ? "good" : "bad"}>
              Production {release.productionState}
            </Chip>
            <Chip
              tone={
                release.liveStatus != null && release.liveStatus < 400
                  ? "good"
                  : "bad"
              }
            >
              Live site {release.liveStatus ?? "unreachable"}
            </Chip>
            <EngineerOnly>
              {release.stageCommit && (
                <Chip>stage @ {release.stageCommit.slice(0, 8)}</Chip>
              )}
              {release.mainCommit && (
                <Chip>main @ {release.mainCommit.slice(0, 8)}</Chip>
              )}
            </EngineerOnly>
          </div>
          <a
            href={release.liveUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[13px] text-cyan hover:underline"
          >
            <ExternalLink className="size-3.5" /> {release.liveUrl}
          </a>
          {!!release.reasons.length && (
            <ul className="list-disc pl-5 text-[12.5px] text-bad">
              {release.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

const EVENT_CLS = {
  log: "text-ink",
  tool: "text-cyan",
  check: "text-gold-2",
  status: "text-mist",
} as const;

function LogPanel({ d }: { d: WorkDetail }) {
  const job = d.jobs[0];
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [d.events.length]);
  if (!job)
    return (
      <p className="py-16 text-center text-[13.5px] text-mist">
        Nothing has run yet.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Chip
          tone={
            job.status === "done"
              ? "good"
              : job.status === "failed"
                ? "bad"
                : "gold"
          }
          className="capitalize"
        >
          {job.status}
        </Chip>
        <span className="text-fog">
          {job.kind.replace("_", " ")} · {modelLabel(job.provider, job.model)}
        </span>
        {job.error && <span className="text-bad">{job.error}</span>}
      </div>
      <div className="rounded-xl border border-line bg-bg/60 p-3 font-mono text-[12px] leading-relaxed">
        {d.events.length === 0 && (
          <p className="text-mist">Waiting for the engine…</p>
        )}
        {d.events.map((e) => (
          <p
            key={e.id}
            className={cx("whitespace-pre-wrap break-words", EVENT_CLS[e.kind])}
          >
            <span className="mr-2 text-mist">
              {new Date(e.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            {e.text}
          </p>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
