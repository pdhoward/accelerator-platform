import {
  MODEL_ROLES,
  RAIL_LABEL,
  type JobKind,
  type ModelRole,
  type WorkDetail,
  type WorkItem,
} from "./flywheel";

/** Read models only. These never authorize a mutation or replace server gates. */
export const WORKSPACE_LENSES = [
  {
    id: "studio",
    title: "Delivery Studio",
    description: "Intent, artifacts and decisions",
  },
  {
    id: "mission",
    title: "Mission Control",
    description: "Recorded execution and model activity",
  },
  {
    id: "proof",
    title: "Proof Lab",
    description: "Candidate checks and missing evidence",
  },
] as const;
export type WorkspaceLens = (typeof WORKSPACE_LENSES)[number]["id"];
export const CREW_LABEL: Record<ModelRole, string> = {
  consult: "Team Lead",
  design: "Designer",
  plan: "Architect / Planner",
  build: "Builder",
  judge: "Judge / QA",
};
export const JOB_ROLE: Record<JobKind, ModelRole> = {
  discuss: "consult",
  design: "design",
  plan: "plan",
  build_step: "build",
  checkout: "build",
  prove: "judge",
  release: "build",
};
export type ActivityEvent = {
  id: string;
  at: string;
  kind:
    | "created"
    | "queued"
    | "started"
    | "completed"
    | "failed"
    | "cancelled"
    | "artifact"
    | "approved"
    | "check"
    | "observation";
  title: string;
  detail: string;
  role: ModelRole | null;
  jobId?: string;
  model?: string;
  provider?: string;
  target: "design" | "plan" | "ship" | "log";
};
export type CheckState = "passed" | "failed" | "unverified" | "stale";
export type StudioCheck = {
  id: string;
  title: string;
  state: CheckState;
  detail: string;
};
export type StudioSnapshot = {
  schemaVersion: 1;
  source: "recorded" | "sample";
  workId: string;
  observedAt: string;
  summary: string;
  crew: {
    role: ModelRole;
    label: string;
    state: "available" | "queued" | "working" | "blocked" | "completed";
    task: string;
    model: string | null;
  }[];
  activity: ActivityEvent[];
  checks: StudioCheck[];
  receipt: {
    candidate: string | null;
    changed: string[];
    verified: string[];
    unverified: string[];
    risks: string[];
    next: string;
  };
  coverage: string[];
};
export type StudioResponse = { detail: WorkDetail; studio: StudioSnapshot };
export type Briefing = {
  items: WorkItem[];
  active: number;
  delivered: number;
  cancelled: number;
  protected: number;
  decisions: { number: number; title: string; detail: string }[];
};
export type BriefingResponse = Briefing & {
  source: "recorded" | "sample";
  observedAt: string;
  siteName: string;
};

/** Allow only credential-free HTTP(S) links for external previews. */
export function safeWebUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
/** Stable chronological read model with deduplication; invalid dates are omitted. */
export function orderedActivity(events: ActivityEvent[]): ActivityEvent[] {
  return [
    ...new Map(
      events
        .filter((e) => Number.isFinite(Date.parse(e.at)))
        .map((e) => [e.id, e]),
    ).values(),
  ].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );
}
/** Cursor is a count: 0 is before the first event. Pure, bounded and side-effect free. */
export function replayFrame(
  events: ActivityEvent[],
  cursor: number,
): ActivityEvent[] {
  return events.slice(
    0,
    Number.isFinite(cursor)
      ? Math.max(0, Math.min(events.length, Math.floor(cursor)))
      : 0,
  );
}
const stageLabel = (w: WorkItem) =>
  w.stage in RAIL_LABEL
    ? RAIL_LABEL[w.stage as keyof typeof RAIL_LABEL]
    : w.stage === "done"
      ? "Closed"
      : "Cancelled";
/** Summarize current change records without conflating cancellation, release and health. */
export function buildBriefing(items: WorkItem[]): Briefing {
  const changes = items.filter((w) => w.kind === "change");
  const active = changes.filter(
    (w) => !["done", "cancelled"].includes(w.stage),
  );
  const decisions = active.flatMap((w) => {
    const title =
      w.stage === "try" && !w.tryApproved
        ? "Review the preview"
        : w.stage === "release" && !w.released
          ? "Review release readiness"
          : w.stage === "design"
            ? "Review the design"
            : w.stage === "plan" && !w.planApproved
              ? "Review the plan"
              : null;
    return title ? [{ number: w.number, title, detail: w.title }] : [];
  });
  return {
    items,
    active: active.length,
    delivered: changes.filter((w) => w.released && w.release?.ok).length,
    cancelled: changes.filter((w) => w.stage === "cancelled").length,
    protected: active.filter((w) =>
      w.risk.some((r) => ["money", "data", "auth", "security"].includes(r)),
    ).length,
    decisions,
  };
}
/** Project existing evidence into crew activity, checks and replay; never infer authority. */
export function buildStudio(
  d: WorkDetail,
  options: { source?: StudioSnapshot["source"]; observedAt?: string } = {},
): StudioSnapshot {
  const w = d.work;
  const activity: ActivityEvent[] = [
    {
      id: `work:${w.id}`,
      at: w.createdAt,
      kind: "created",
      title: "Improvement opened",
      detail: w.title,
      role: "consult",
      target: "design",
    },
  ];
  for (const doc of d.designs) {
    activity.push({
      id: `design:${doc.id}`,
      at: doc.createdAt,
      kind: "artifact",
      title: `Design v${doc.version} recorded`,
      detail: "Inspect the design and its acceptance criteria.",
      role: "design",
      model: doc.model ?? undefined,
      target: "design",
    });
    if (doc.approvedAt)
      activity.push({
        id: `approval:${doc.id}`,
        at: doc.approvedAt,
        kind: "approved",
        title: `Design v${doc.version} approved`,
        detail:
          "Recorded design approval; release remains separately governed.",
        role: null,
        target: "design",
      });
  }
  for (const j of d.jobs) {
    const role = JOB_ROLE[j.kind];
    const base = {
      role,
      jobId: j.id,
      model: j.model,
      provider: j.provider,
      target: "log" as const,
    };
    activity.push({
      ...base,
      id: `job:${j.id}:queued`,
      at: j.createdAt,
      kind: "queued",
      title: `${CREW_LABEL[role]} queued`,
      detail: `Job: ${j.kind.replaceAll("_", " ")}`,
    });
    if (j.startedAt)
      activity.push({
        ...base,
        id: `job:${j.id}:started`,
        at: j.startedAt,
        kind: "started",
        title: `${CREW_LABEL[role]} started`,
        detail: `Recorded ${j.kind.replaceAll("_", " ")} execution.`,
      });
    if (j.finishedAt && ["done", "failed", "cancelled"].includes(j.status))
      activity.push({
        ...base,
        id: `job:${j.id}:finished`,
        at: j.finishedAt,
        kind:
          j.status === "done"
            ? "completed"
            : j.status === "failed"
              ? "failed"
              : "cancelled",
        title: `${CREW_LABEL[role]} ${j.status === "done" ? "finished" : j.status}`,
        detail:
          j.status === "done"
            ? "Job finished. Acceptance evidence is evaluated separately."
            : "Inspect the job log before retrying; no recovery is claimed.",
        target: j.kind === "prove" || j.kind === "release" ? "ship" : "log",
      });
  }
  // Legacy events have no structured verdict/candidate: do not infer passing tests from text.
  for (const e of d.events)
    activity.push({
      id: `event:${e.id}`,
      at: e.at,
      kind: "observation",
      title: `Runner ${e.kind} event recorded`,
      detail:
        "Inspect the original event in Live log. This entry is not a verified check result.",
      role: d.jobs[0] ? JOB_ROLE[d.jobs[0].kind] : null,
      jobId: d.jobs[0]?.id,
      target: "log",
    });
  const p = w.proof;
  const stale =
    !!p &&
    (d.jobs.some(
      (j) =>
        ["build_step", "design", "plan"].includes(j.kind) &&
        Date.parse(j.startedAt ?? j.createdAt) > Date.parse(p.at),
    ) ||
      d.designs.some((x) => Date.parse(x.createdAt) > Date.parse(p.at)));
  const state = (result: boolean | null | undefined): CheckState =>
    stale
      ? "stale"
      : !p?.commit || !Number.isFinite(Date.parse(p.at)) || result == null
        ? "unverified"
        : result
          ? "passed"
          : "failed";
  const tests = p?.tests;
  const checks: StudioCheck[] = [
    {
      id: "types",
      title: "TypeScript",
      state: state(p?.typecheck),
      detail: p
        ? p.typecheck
          ? "Typecheck recorded as successful."
          : "Typecheck recorded as failed."
        : "No candidate check recorded.",
    },
    {
      id: "tests",
      title: "Unit / integration suite",
      state: state(
        tests && tests.total > 0
          ? tests.failed === 0 && tests.passed === tests.total
          : null,
      ),
      detail: tests
        ? `${tests.passed} passed · ${tests.failed} failed · ${tests.total} executed. Counts do not establish business coverage.`
        : "No executed test results recorded.",
    },
    {
      id: "build",
      title: "Production build",
      state: state(p?.build),
      detail:
        p?.build == null
          ? "No build execution recorded."
          : p.build
            ? "Build recorded as successful."
            : "Build recorded as failed.",
    },
    {
      id: "preview",
      title: "Preview deployment",
      state: state(p ? p.pushed && p.previewState === "success" : null),
      detail: p
        ? `Deployment state: ${p.previewState}. A deployment is not business-journey QA.`
        : "No preview deployment evidence recorded.",
    },
  ];
  if (p)
    activity.push({
      id: `proof:${w.id}:${p.at}`,
      at: p.at,
      kind: "check",
      title: "Candidate proof recorded",
      detail: p.ok
        ? "Inspect individual checks, candidate identity and remaining gaps."
        : "Candidate did not pass the recorded Prove verdict.",
      role: "judge",
      target: "ship",
    });
  if (w.release)
    activity.push({
      id: `release:${w.id}:${w.release.at}`,
      at: w.release.at,
      kind: w.release.ok ? "completed" : "failed",
      title: w.release.ok
        ? "Release result recorded"
        : "Release needs attention",
      detail:
        "Deployment and HTTP observations only; stabilization and business outcomes are not established.",
      role: "build",
      target: "ship",
    });
  const crew = MODEL_ROLES.map((role) => {
    const jobs = d.jobs
      .filter((j) => JOB_ROLE[j.kind] === role)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const active = jobs.find(
      (j) => j.status === "running" || j.status === "queued",
    );
    const j = active ?? jobs[0];
    const status = j?.status;
    return {
      role,
      label: CREW_LABEL[role],
      state:
        status === "running"
          ? ("working" as const)
          : status === "queued"
            ? ("queued" as const)
            : status === "failed"
              ? ("blocked" as const)
              : status === "done"
                ? ("completed" as const)
                : ("available" as const),
      task: j
        ? `${j.kind.replaceAll("_", " ")} · ${j.status}${!d.runnerOnline && active ? " · runner offline; status may be stale" : ""}`
        : "No job recorded in this work item",
      model: j?.model ?? null,
    };
  });
  const unverified = [
    ...checks
      .filter((c) => c.state !== "passed")
      .map((c) => `${c.title}: ${c.state}.`),
    "Business-journey QA is not recorded in the current evidence schema.",
    "Recovery rehearsal and post-release stabilization are not recorded.",
    "Token consumption and per-job costs are not available in these records.",
  ];
  const next =
    w.stage === "cancelled"
      ? "Closed without delivery."
      : w.stage === "done"
        ? "Inspect release evidence and remaining operational unknowns."
        : d.jobs.some((j) => ["running", "queued"].includes(j.status))
          ? "Await the active job; inspect any blocker before further action."
          : `Continue at ${stageLabel(w)} using the existing authorized controls.`;
  return {
    schemaVersion: 1,
    source: options.source ?? "recorded",
    workId: w.id,
    observedAt: options.observedAt ?? w.updatedAt,
    summary: `${stageLabel(w)} · ${w.title}. ${next}`,
    crew,
    activity: orderedActivity(activity),
    checks,
    receipt: {
      candidate: p?.commit ?? null,
      changed: [...new Set(d.steps.flatMap((s) => s.evidence.files ?? []))],
      verified: checks.filter((c) => c.state === "passed").map((c) => c.title),
      unverified,
      risks: [
        ...w.risk.map((r) => `Protected scope: ${r}`),
        ...(p?.reasons ?? []),
        ...(w.release?.reasons ?? []),
      ],
      next,
    },
    coverage: [
      "Replay reconstructs recorded job boundaries, design approvals and proof snapshots; it is not a recording of private model reasoning.",
      "At most the latest 20 jobs and first 400 events of the latest job are available. Older jobs/events may be omitted.",
      "Plan approval and Try approval timestamps are not available; no approval chronology is invented.",
    ],
  };
}
