import {
  DEFAULT_MODELS,
  resolveModels,
  workActions,
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
    cadence: "every_step",
    risk: ["data"],
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
    }),
  };
}
