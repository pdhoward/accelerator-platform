import { describe, expect, it } from "vitest";

import { ago, buildInstruments, span, type InstrumentEvidence, type InstrumentInputs, type InstrumentLedger, type InstrumentWork, type Reading } from "./instruments";

const NOW = "2026-10-18T12:00:00.000Z";
const at = (hoursAgo: number) => new Date(Date.parse(NOW) - hoursAgo * 3_600_000).toISOString();
const DAY = 24;

const work = (w: Partial<InstrumentWork> & { number: number }): InstrumentWork => ({
  title: `Item ${w.number}`, kind: "change", stage: "build", complexity: "medium", createdAt: at(10 * DAY),
  released: false, releasedAt: null, paused: false, pending: null, ...w,
});
const ev = (e: Partial<InstrumentEvidence> & { kind: string; at: string }): InstrumentEvidence => ({
  ok: true, commit: "abc12345ff", passed: null, failed: null, total: null, work: 1, step: null, detail: {}, ...e,
});
const led = (l: Partial<InstrumentLedger> & { at: string; actorLabel: string }): InstrumentLedger => ({
  kind: "step_checks", actorKind: "crew", counts: true, work: 1, summary: "Step built", ...l,
});
const inputs = (i: Partial<InstrumentInputs>): InstrumentInputs => ({ now: NOW, scope: { kind: "site" }, baselineTests: null, work: [], evidence: [], ledger: [], ...i });
const read = (r: Reading[], id: string) => r.find((x) => x.id === id)!;

describe("time words", () => {
  it("says how long ago and how long, plainly", () => {
    expect(ago(at(0.2), NOW)).toBe("12 min ago");
    expect(ago(at(3), NOW)).toBe("3 h ago");
    expect(ago(at(50), NOW)).toBe("2 days ago");
    expect(span(4.2 * 3_600_000)).toBe("4.2 h");
    expect(span(30 * 60_000)).toBe("30 min");
  });
});

describe("missing is never zero", () => {
  it("shows unconnected measures as not connected, with no number", () => {
    const { site } = buildInstruments(inputs({}));
    for (const id of ["census", "lighthouse", "uptime", "errors", "budget"]) {
      expect(read(site, id)).toMatchObject({ condition: "not_connected", state: "Not connected", headline: null });
    }
  });
  it("tells no data apart from a real zero", () => {
    expect(read(buildInstruments(inputs({})).site, "tests")).toMatchObject({ condition: "unverified", headline: null });
    expect(read(buildInstruments(inputs({})).site, "changes")).toMatchObject({ condition: "unverified", headline: null });
    // A quiet week on a connected source is a true zero.
    const quiet = buildInstruments(inputs({ evidence: [ev({ kind: "step_checks", at: at(20 * DAY), total: 5, passed: 5 })] }));
    expect(read(quiet.site, "changes")).toMatchObject({ condition: "verified", state: "Quiet", headline: "0" });
  });
});

describe("tests", () => {
  const run = (hoursAgo: number, total: number, failed = 0) => ev({ kind: "prove", at: at(hoursAgo), total, passed: total - failed, failed });
  it("reads the latest run, its growth this week and its source", () => {
    const r = read(buildInstruments(inputs({ baselineTests: 230, evidence: [run(9 * DAY, 242), run(1, 248)] })).site, "tests");
    expect(r).toMatchObject({ condition: "verified", state: "Passing", headline: "248", unit: "of 248 passing", change: "+6 this week" });
    expect(r.facts[1]).toBe("Suite 248 against a baseline of 230");
    expect(r.trend).toEqual([242, 248]);
  });
  it("flags failing tests and a suite below its baseline", () => {
    expect(read(buildInstruments(inputs({ evidence: [run(1, 248, 2)] })).site, "tests")).toMatchObject({ condition: "attention", state: "Failing" });
    expect(read(buildInstruments(inputs({ baselineTests: 250, evidence: [run(1, 248)] })).site, "tests")).toMatchObject({ condition: "attention", state: "Below baseline" });
  });
  it("calls a two-week-old run stale, not verified", () => {
    expect(read(buildInstruments(inputs({ evidence: [run(15 * DAY, 248)] })).site, "tests")).toMatchObject({ condition: "unverified", state: "Stale" });
  });
});

describe("state integrity", () => {
  const shipped = work({ number: 1, released: true, releasedAt: at(2), stage: "learn" });
  const chain = [
    ev({ kind: "step_checks", at: at(6), step: "s1", total: 10, passed: 10 }),
    ev({ kind: "prove", at: at(5), total: 10, passed: 10 }),
    ev({ kind: "release", at: at(2), commit: "main999" }),
  ];
  it("verifies the live state when every required check passed on the released candidate", () => {
    const r = read(buildInstruments(inputs({ work: [shipped], evidence: chain })).site, "integrity");
    expect(r).toMatchObject({ condition: "verified", state: "Verified", headline: "3/3", evidence: { href: "workItem", number: 1 } });
  });
  it("needs a look when the live check failed", () => {
    const r = read(buildInstruments(inputs({ work: [shipped], evidence: [...chain.slice(0, 2), ev({ kind: "release", at: at(2), ok: false })] })).site, "integrity");
    expect(r).toMatchObject({ condition: "attention", headline: "2/3" });
  });
  it("treats proof as stale once new code lands after Prove", () => {
    const item = work({ number: 1 });
    const r = read(
      buildInstruments(inputs({ scope: { kind: "work", number: 1 }, work: [item], evidence: [...chain.slice(0, 2), ev({ kind: "step_checks", at: at(1), step: "s2", total: 11, passed: 11 })] })).site,
      "integrity",
    );
    expect(r).toMatchObject({ condition: "unverified", headline: "1/2" });
    expect(r.facts.join(" ")).toContain("stale: new code since the last Prove");
  });
  it("says the live state isn't established before any release", () => {
    expect(read(buildInstruments(inputs({ work: [work({ number: 1 })] })).site, "integrity")).toMatchObject({ condition: "unverified", state: "Not established", headline: null });
  });
});

describe("work in flight", () => {
  it("counts decisions waiting on you and flags one older than a day", () => {
    const r = read(
      buildInstruments(inputs({ work: [work({ number: 1, complexity: "low" }), work({ number: 2, pending: { title: "Ship it", since: at(30) } }), work({ number: 3, stage: "done" })] })).site,
      "flight",
    );
    expect(r).toMatchObject({ condition: "attention", state: "Waiting on you", headline: "1", unit: "decision waiting on you", evidence: { number: 2 } });
    expect(r.facts[0]).toBe("2 active items: 1 low, 1 medium");
  });
  it("is clear when nothing waits", () => {
    expect(read(buildInstruments(inputs({})).site, "flight")).toMatchObject({ condition: "verified", state: "Clear", headline: "0" });
  });
});

describe("delivery flow", () => {
  it("shows the median lead time but holds judgement until three releases", () => {
    const w = [work({ number: 1, released: true, createdAt: at(10), releasedAt: at(5) })];
    const r = read(buildInstruments(inputs({ work: w, evidence: [ev({ kind: "release", at: at(5) })] })).site, "delivery");
    expect(r).toMatchObject({ condition: "unverified", state: "Not enough data (1 of 3)", headline: "5.0 h", unit: "median lead time" });
  });
  it("flags a change-failure rate above a quarter", () => {
    const releases = [1, 2, 3, 4].map((k) => ev({ kind: "release", at: at(k * DAY), ok: k > 2 }));
    expect(read(buildInstruments(inputs({ evidence: releases })).site, "delivery")).toMatchObject({ condition: "attention", state: "Unstable" });
  });
});

describe("crew face", () => {
  it("shows an idle role as idle, not failing", () => {
    expect(read(buildInstruments(inputs({})).crew, "judge")).toMatchObject({ condition: "unverified", state: "Idle", headline: "0" });
  });
  it("counts only evidence-backed contributions and reads first-pass success", () => {
    const ledger = [
      led({ at: at(1), actorLabel: "Builder" }),
      led({ at: at(2), actorLabel: "Builder" }),
      led({ at: at(3), actorLabel: "Builder", counts: false }),
      led({ at: at(4), actorLabel: "Builder", kind: "repair", counts: false, summary: "Repairing step 2" }),
      led({ at: at(5), actorLabel: "Team Lead", kind: "assessed", counts: false }),
    ];
    const builder = read(buildInstruments(inputs({ ledger })).crew, "builder");
    expect(builder).toMatchObject({ condition: "verified", headline: "2" });
    expect(builder.rings).toEqual([
      { label: "Work landed vs usual pace", value: 2, goal: 1, display: "2 / 1" },
      { label: "First-pass success", value: 67, goal: 100, display: "67%" },
    ]);
    expect(builder.facts[1]).toBe("1 self-repair in 28 days");
    expect(builder.days).toHaveLength(28);
    expect(read(buildInstruments(inputs({ ledger })).crew, "lead")).toMatchObject({ headline: "0", state: "Active" });
  });
  it("flags a role whose results mostly fail, given enough of them", () => {
    const ledger = Array.from({ length: 6 }, (_, k) => led({ at: at(k + 1), actorLabel: "Builder", counts: k === 0 }));
    expect(read(buildInstruments(inputs({ ledger })).crew, "builder")).toMatchObject({ condition: "attention", state: "Struggling" });
  });
  it("gives people their own row of decisions", () => {
    const ledger = [led({ at: at(1), actorLabel: "Patrick", actorKind: "person", kind: "decision" })];
    const people = read(buildInstruments(inputs({ ledger })).crew, "people");
    expect(people).toMatchObject({ headline: "1", unit: "decisions this week" });
    expect(people.rings).toHaveLength(1);
  });
});

describe("where the dial rests", () => {
  it("rests on what needs attention first", () => {
    const i = buildInstruments(inputs({ evidence: [ev({ kind: "prove", at: at(1), total: 10, passed: 8, failed: 2 })] }));
    expect(i.rest).toEqual({ face: "site", id: "tests" });
  });
  it("rests on state integrity when everything is verified or merely quiet", () => {
    const shipped = work({ number: 1, released: true, releasedAt: at(2), stage: "learn" });
    const chain = [ev({ kind: "step_checks", at: at(6), step: "s1", total: 10, passed: 10 }), ev({ kind: "prove", at: at(5), total: 10, passed: 10 }), ev({ kind: "release", at: at(2) })];
    const i = buildInstruments(inputs({ work: [shipped], evidence: chain }));
    // An idle Judge and too few releases are honest but not actionable: the dial rests on integrity.
    expect(i.rest).toEqual({ face: "site", id: "integrity" });
  });
  it("rests on a stale reading before declaring all is well", () => {
    const i = buildInstruments(inputs({ evidence: [ev({ kind: "prove", at: at(15 * DAY), total: 10, passed: 10 })] }));
    expect(i.rest).toEqual({ face: "site", id: "tests" });
  });
  it("rests on a struggling crew role when the site itself is fine", () => {
    const ledger = Array.from({ length: 6 }, (_, k) => led({ at: at(k + 1), actorLabel: "Builder", counts: k === 0 }));
    expect(buildInstruments(inputs({ ledger })).rest).toEqual({ face: "crew", id: "builder" });
  });
});

describe("a Work item's own dial", () => {
  it("reads only that item, with the item-level measures", () => {
    const i = buildInstruments(
      inputs({
        scope: { kind: "work", number: 2 },
        work: [work({ number: 1 }), work({ number: 2 })],
        evidence: [ev({ kind: "prove", at: at(1), total: 9, passed: 9, work: 1 }), ev({ kind: "prove", at: at(2), total: 7, passed: 7, work: 2 })],
      }),
    );
    expect(i.site.map((r) => r.id)).toEqual(["integrity", "tests", "flight", "changes"]);
    expect(read(i.site, "tests").headline).toBe("7");
  });
});
