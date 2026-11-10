import { describe, expect, it } from "vitest";

import { spendScorecard, type SpendJob, type SpendUsage } from "./spend";

const now = new Date("2026-11-09T18:00:00Z");
const job = (id: string, kind: string, costUsd: number | null, at: string, status = "done"): SpendJob => ({ id, kind, model: "claude-sonnet-5-5", costUsd, at, status, workNumber: null, title: null });
const use = (role: string, costUsd: number, at: string, model = "claude-haiku-5-5"): SpendUsage => ({ role, model, tokensIn: 4000, tokensOut: 200, costUsd, at });

describe("the spend scorecard", () => {
  it("splits a metered job by the models it used, and shows the newest unit's cost beside the average", () => {
    const card = spendScorecard({
      now, days: 30,
      jobs: [
        { ...job("old", "ingest", 10.4, "2026-11-05T10:00:00Z"), model: "claude-opus-5-5" },
        {
          ...job("new", "ingest", 3.36, "2026-11-09T15:00:00Z"), model: "claude-opus-5-5",
          meter: [{ model: "claude-sonnet-5-5", tokensIn: 900_000, tokensOut: 70_000, costUsd: 2.4 }, { model: "claude-opus-5-5", tokensIn: 120_000, tokensOut: 8_000, costUsd: 0.96 }],
        },
      ],
      usage: [], proofs: [],
    });
    const ingest = card.lines.find((l) => l.key === "crew:ingest")!;
    expect(ingest).toMatchObject({ count: 2, costUsd: 13.76, perUnitUsd: 6.88, latestUsd: 3.36, latestAt: "2026-11-09T15:00:00Z" });
    expect(card.byModel).toEqual([
      { model: "claude-opus-5-5", costUsd: 11.36, tokensIn: 120_000, tokensOut: 8_000 },
      { model: "claude-sonnet-5-5", costUsd: 2.4, tokensIn: 900_000, tokensOut: 70_000 },
    ]);
    expect(card.totalUsd).toBe(13.76);
  });

  it("shows which work costs the money, most expensive first, with a cost per unit", () => {
    const card = spendScorecard({
      now, days: 30,
      jobs: [job("a", "ingest", 6, "2026-11-05T10:00:00Z"), job("b", "ingest", 4, "2026-11-06T10:00:00Z"), job("c", "discuss", 0.3, "2026-11-09T10:00:00Z")],
      usage: [use("search", 0.0006, "2026-11-09T12:00:00Z"), use("search", 0.0004, "2026-11-09T12:01:00Z"), use("compile", 0.02, "2026-11-09T11:00:00Z", "claude-sonnet-5-5")],
      proofs: [{ version: "v1", at: "2026-11-09T09:00:00Z", costUsd: 0.2, status: "passed" }],
    });
    expect(card.lines.map((l) => [l.key, l.costUsd, l.count])).toEqual([
      ["crew:ingest", 10, 2], ["crew:discuss", 0.3, 1], ["proofs:run", 0.2, 1], ["app:compile", 0.02, 1], ["app:search", 0.001, 2],
    ]);
    expect(card.lines[0]!.perUnitUsd).toBe(5);
    expect(card.lines.find((l) => l.key === "app:search")!.perUnitUsd).toBe(0.0005);
    expect(card.totalUsd).toBe(10.521);
    expect(card.byArea.find((a) => a.area === "crew")).toMatchObject({ costUsd: 10.3, share: 98 });
    expect(card.topJobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("splits spend by day and model, and keeps today and the last 7 days", () => {
    const card = spendScorecard({
      now, days: 7,
      jobs: [job("old", "ingest", 50, "2026-10-01T10:00:00Z"), job("a", "ingest", 2, "2026-11-04T10:00:00Z")],
      usage: [use("search", 0.5, "2026-11-09T12:00:00Z")],
      proofs: [],
    });
    expect(card.daily).toHaveLength(7);
    expect(card.daily[0]!.day).toBe("2026-11-03");
    expect(card.daily.at(-1)).toEqual({ day: "2026-11-09", crew: 0, app: 0.5, proofs: 0 });
    expect(card.totalUsd).toBe(2.5); // the October job is outside the window
    expect(card.todayUsd).toBe(0.5);
    expect(card.last7Usd).toBe(2.5);
    expect(card.byModel.map((m) => m.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
  });

  it("says plainly where the meter has gaps", () => {
    const card = spendScorecard({ now, days: 30, jobs: [job("x", "ingest", null, "2026-11-08T10:00:00Z")], usage: [], proofs: [] });
    expect(card.notes).toHaveLength(2);
    expect(card.notes[0]).toMatch(/^1 finished crew job reported no cost/);
    expect(card.notes[1]).toMatch(/hasn't reported its own model use/);
  });
});
