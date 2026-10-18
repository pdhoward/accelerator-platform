import {
  DEFAULT_MODELS,
  resolveModels,
  workActions,
  type InstrumentInputs,
  type WorkDetail,
} from "@accelerator/domain";
/** Synthetic, read-only UX fixture. Never persisted or used as live-site evidence. */
export function studioSample(): WorkDetail {
  const t = (minutes: number) =>
    new Date(Date.UTC(2026, 9, 15, 9, minutes)).toISOString();
  const models = resolveModels(DEFAULT_MODELS);
  const work: WorkDetail["work"] = {
    id: "sample-quote",
    number: 1,
    kind: "change",
    title: "Make mobile quote requests easier to complete",
    stage: "try",
    risk: ["data"],
    complexity: "high",
    recommendedComplexity: "high",
    complexityReason: "Quote requests store customer contact details.",
    complexitySetBy: "platform",
    ready: true,
    autoShip: false,
    paused: false,
    proofRepairs: 0,
    branch: "work/sample-quote",
    planApproved: true,
    previewUrl: null,
    proof: {
      ok: true,
      reasons: [],
      typecheck: true,
      build: true,
      tests: { passed: 18, failed: 0, total: 18 },
      baseline: 16,
      pushed: true,
      previewState: "success",
      branch: "work/sample-quote",
      commit: "sample-candidate",
      previewUrl: null,
      previewStatus: null,
      at: t(12),
    },
    tryApproved: false,
    released: false,
    release: null,
    createdAt: t(0),
    updatedAt: t(12),
  };
  const jobs: WorkDetail["jobs"] = [
    {
      id: "sample-design",
      kind: "design",
      status: "done",
      provider: models.design.provider,
      model: models.design.model,
      error: null,
      createdAt: t(1),
      startedAt: t(2),
      finishedAt: t(4),
    },
    {
      id: "sample-build",
      kind: "build_step",
      status: "done",
      provider: models.build.provider,
      model: models.build.model,
      error: null,
      createdAt: t(5),
      startedAt: t(6),
      finishedAt: t(9),
    },
    {
      id: "sample-prove",
      kind: "prove",
      status: "done",
      provider: models.judge.provider,
      model: models.judge.model,
      error: null,
      createdAt: t(10),
      startedAt: t(11),
      finishedAt: t(12),
    },
  ].reverse() as WorkDetail["jobs"];
  return {
    work,
    jobs,
    models,
    runnerOnline: false,
    events: [],
    messages: [
      {
        id: "sample-person",
        authorKind: "person",
        authorLabel: "Functional expert",
        model: null,
        stage: "discuss",
        body: "Help customers request a quote on mobile. Keep product selection and routing rules intact.",
        createdAt: t(0),
      },
      {
        id: "sample-lead",
        authorKind: "model",
        authorLabel: "Team Lead",
        model: models.consult.model,
        stage: "design",
        body: "Proposed: simplify the mobile form and keep the selected product visible. The design preserves routing rules. Review the candidate checks, then try the experience before deciding on release. This is an illustrative conversation.",
        createdAt: t(1),
      },
    ],
    designs: [
      {
        id: "sample-design-doc",
        version: 1,
        authorLabel: "Designer",
        model: models.design.model,
        createdAt: t(4),
        approvedAt: t(5),
        body: "# Mobile quote journey\n\n## Intended improvement\nMake the next action clear and reduce unnecessary form friction.\n\n## Protected behavior\n- Preserve selected product and inquiry routing.\n- Do not alter pricing or write to the product catalog.\n\n## Acceptance\n- The selected product remains visible on narrow screens.\n- Invalid contact details show a clear correction.\n- Duplicate submission does not create a second inquiry.\n\n## Review boundary\nThis is a synthetic UX example, not a delivered change or executed test report.",
      },
    ],
    steps: [
      {
        id: "sample-step",
        position: 1,
        title: "Simplify the form and protect inquiry routing",
        detail:
          "Component layout, input validation and focused regression checks.",
        status: "done",
        attempts: 1,
        evidence: {
          summary: "Illustrative completion",
          files: ["components/quote-form.tsx", "domain/inquiry.test.ts"],
          commit: "sample-candidate",
        },
      },
    ],
    actions: workActions({
      ...work,
      jobRunning: false,
      latestDesign: { version: 1, approved: true },
      steps: [{ status: "done" }],
      proven: true,
      proofFailed: false,
    }),
    crewNext: null,
    decision: null,
  };
}

/**
 * Synthetic, read-only records for the Cockpit Dial in keyless demo mode:
 * one sample improvement mid-flight, with a few days of crew activity.
 * Labelled "sample" by the API; never persisted or used as live evidence.
 */
export function instrumentsSample(now: string): Omit<InstrumentInputs, "scope"> {
  const w = studioSample().work;
  const at = (hoursAgo: number) => new Date(Date.parse(now) - hoursAgo * 3_600_000).toISOString();
  const crew = (hoursAgo: number, actorLabel: string, kind: string, summary: string, counts = true): InstrumentInputs["ledger"][number] => ({
    at: at(hoursAgo), kind, actorKind: "crew", actorLabel, counts, work: 1, summary,
  });
  return {
    now,
    baselineTests: 16,
    work: [
      {
        number: 1, title: w.title, kind: "change", stage: w.stage, complexity: w.complexity, createdAt: at(80),
        released: false, releasedAt: null, paused: false, pending: { title: "Approve the preview for release", since: at(5) },
      },
    ],
    evidence: [
      { kind: "step_checks", ok: false, commit: "s4mp1e01", passed: 15, failed: 1, total: 16, at: at(30), work: 1, step: "sample-step", detail: {} },
      { kind: "step_checks", ok: true, commit: "s4mp1e02", passed: 18, failed: 0, total: 18, at: at(28), work: 1, step: "sample-step", detail: {} },
      { kind: "prove", ok: true, commit: "s4mp1e02", passed: 18, failed: 0, total: 18, at: at(6), work: 1, step: null, detail: {} },
    ],
    ledger: [
      crew(72, "Team Lead", "assessed", "Rated High complexity: quote requests store contact details.", false),
      crew(70, "Designer", "drafted", "Design v1 drafted for #1.", false),
      { at: at(60), kind: "decision", actorKind: "person", actorLabel: "Functional expert", counts: true, work: 1, summary: "Approved design v1." },
      crew(58, "Planner", "drafted", "Plan of 1 step drafted for #1.", false),
      { at: at(50), kind: "decision", actorKind: "person", actorLabel: "Functional expert", counts: true, work: 1, summary: "Approved the plan (1 step)." },
      crew(30, "Builder", "step_checks", "Step blocked by the Protocol: 1 test failing.", false),
      crew(29, "Builder", "repair", "Repairing step 1 of #1 (repair 1 of 2).", false),
      crew(28, "Builder", "step_checks", "Step built and checked: simplified the mobile quote form."),
      crew(6, "Builder", "prove", "Proven: every check passed and the preview is up (s4mp1e02)."),
    ],
  };
}
