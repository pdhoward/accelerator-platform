import { describe, expect, it } from "vitest";
import {
  buildBriefing,
  buildStudio,
  orderedActivity,
  replayFrame,
  safeWebUrl,
} from "./studio";
import {
  DEFAULT_MODELS,
  resolveModels,
  workActions,
  type WorkDetail,
  type WorkItem,
} from "./flywheel";
const at = "2026-10-15T12:00:00Z";
function detail(): WorkDetail {
  const work: WorkItem = {
    id: "w1",
    number: 1,
    kind: "change",
    title: "Protect quote requests",
    stage: "discuss",
    risk: [],
    complexity: "medium",
    recommendedComplexity: null,
    complexityReason: null,
    complexitySetBy: "platform",
    ready: false,
    autoShip: false,
    paused: false,
    proofRepairs: 0,
    branch: null,
    planApproved: false,
    previewUrl: null,
    proof: null,
    tryApproved: false,
    released: false,
    release: null,
    createdAt: at,
    updatedAt: at,
  };
  return {
    work,
    messages: [],
    designs: [],
    steps: [],
    jobs: [],
    events: [],
    runnerOnline: false,
    models: resolveModels(DEFAULT_MODELS),
    actions: workActions({
      ...work,
      jobRunning: false,
      latestDesign: null,
      steps: [],
      proven: false,
      proofFailed: false,
    }),
    crewNext: null,
    decision: null,
  };
}
describe("studio evidence and truthful activity", () => {
  it("never presents absent evidence as passed or release-ready", () => {
    const s = buildStudio(detail());
    expect(s.checks.every((c) => c.state === "unverified")).toBe(true);
    expect(s.receipt.unverified).toContain(
      "Business-journey QA is not recorded in the current evidence schema.",
    );
    expect(s.crew.every((c) => c.state === "available")).toBe(true);
  });
  it("does not treat queued jobs as agents already working", () => {
    const d = detail();
    d.jobs = [
      {
        id: "j1",
        kind: "design",
        status: "queued",
        provider: "anthropic",
        model: "model-a",
        error: null,
        createdAt: at,
        startedAt: null,
        finishedAt: null,
      },
    ];
    const s = buildStudio(d);
    expect(s.crew.find((c) => c.role === "design")?.state).toBe("queued");
    expect(s.activity.some((e) => e.kind === "started")).toBe(false);
    expect(s.activity.find((e) => e.jobId === "j1")?.model).toBe("model-a");
  });
  it("records completed and failed jobs without inventing specialist dialogue", () => {
    const d = detail();
    d.jobs = [
      {
        id: "j1",
        kind: "build_step",
        status: "failed",
        provider: "anthropic",
        model: "actual-model",
        error: "private raw error",
        createdAt: at,
        startedAt: at,
        finishedAt: "2026-10-15T12:01:00Z",
      },
    ];
    const s = buildStudio(d);
    expect(s.crew.find((c) => c.role === "build")?.state).toBe("blocked");
    expect(s.activity.some((e) => e.kind === "failed")).toBe(true);
    expect(JSON.stringify(s)).not.toContain("private raw error");
  });
  it("binds proof to a candidate and rejects zero executed tests", () => {
    const d = detail();
    d.work.proof = {
      ok: true,
      reasons: [],
      typecheck: true,
      build: null,
      tests: { passed: 0, failed: 0, total: 0 },
      baseline: 0,
      pushed: true,
      previewState: "success",
      branch: "work/1",
      commit: "abc",
      previewUrl: "https://preview.example",
      previewStatus: 200,
      at,
    };
    const s = buildStudio(d);
    expect(s.checks.find((c) => c.id === "tests")?.state).toBe("unverified");
    expect(s.checks.find((c) => c.id === "build")?.state).toBe("unverified");
    expect(s.receipt.candidate).toBe("abc");
  });
  it("marks old proof stale after a later build starts", () => {
    const d = detail();
    d.work.proof = {
      ok: true,
      reasons: [],
      typecheck: true,
      build: true,
      tests: { passed: 4, failed: 0, total: 4 },
      baseline: 4,
      pushed: true,
      previewState: "success",
      branch: "work/1",
      commit: "abc",
      previewUrl: null,
      previewStatus: null,
      at,
    };
    d.jobs = [
      {
        id: "j2",
        kind: "build_step",
        status: "running",
        provider: "anthropic",
        model: "model-b",
        error: null,
        createdAt: "2026-10-15T12:01:00Z",
        startedAt: "2026-10-15T12:01:01Z",
        finishedAt: null,
      },
    ];
    expect(buildStudio(d).checks.every((c) => c.state === "stale")).toBe(true);
  });
  it("does not present an unbound candidate as verified", () => {
    const d = detail();
    d.work.proof = {
      ok: true,
      reasons: [],
      typecheck: true,
      build: true,
      tests: { passed: 4, failed: 0, total: 4 },
      baseline: 4,
      pushed: true,
      previewState: "success",
      branch: "work/1",
      commit: null,
      previewUrl: null,
      previewStatus: null,
      at,
    };
    expect(buildStudio(d).checks.every((c) => c.state === "unverified")).toBe(
      true,
    );
    d.work.proof.commit = "abc";
    d.work.proof.at = "invalid";
    expect(buildStudio(d).checks.every((c) => c.state === "unverified")).toBe(
      true,
    );
  });
  it("deduplicates replay events and orders ties deterministically", () => {
    const e = buildStudio(detail()).activity[0]!;
    expect(
      orderedActivity([e, { ...e }, { ...e, id: "aaa" }]).map((x) => x.id),
    ).toEqual(["aaa", e.id].sort());
  });
  it("replay is a bounded read-only prefix, including empty and invalid cursors", () => {
    const events = buildStudio(detail()).activity;
    expect(replayFrame(events, 0)).toEqual([]);
    expect(replayFrame(events, 100)).toEqual(events);
    expect(replayFrame(events, -1)).toEqual([]);
    expect(replayFrame(events, NaN)).toEqual([]);
    expect(replayFrame([], 4)).toEqual([]);
  });
  it("ignores malformed timestamps rather than inventing chronology", () => {
    const d = detail();
    d.work.createdAt = "bad";
    expect(buildStudio(d).activity).toEqual([]);
  });
  it("does not expose unsafe preview protocols or URL credentials", () => {
    expect(safeWebUrl("javascript:alert(1)")).toBeNull();
    expect(safeWebUrl("https://user:secret@example.com")).toBeNull();
    expect(safeWebUrl("https://preview.example")).toBe(
      "https://preview.example/",
    );
  });
});
describe("executive briefing from current Work records", () => {
  it("keeps cancellation separate from delivery and excludes installation from change counts", () => {
    const a = detail().work;
    const b = { ...a, id: "w2", number: 2, stage: "cancelled" as const };
    const c = { ...a, id: "w3", number: 3, kind: "install" as const };
    const s = buildBriefing([a, b, c]);
    expect(s.active).toBe(1);
    expect(s.delivered).toBe(0);
    expect(s.cancelled).toBe(1);
  });
  it("shows decisions only when the rail is awaiting a real next action", () => {
    const d = detail();
    d.work.stage = "try";
    const s = buildBriefing([d.work]);
    expect(s.decisions).toHaveLength(1);
    expect(s.decisions[0]?.title).toBe("Review the preview");
  });
});
