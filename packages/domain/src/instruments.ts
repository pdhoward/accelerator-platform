import { readCensus } from "./census";
import type { Complexity } from "./complexity";
import type { WorkStage } from "./flywheel";

/**
 * The Cockpit Dial's readings (gen2-crew.md §19.5, D50): a pure projection of
 * recorded evidence, ledger entries and Work items into one reading per
 * measure. Rules (rule 14, Trusted AI):
 * - every reading carries its source and when it was observed;
 * - missing is never zero: no source is "not_connected", too little data is
 *   "unverified" with the count it has;
 * - a model never sets a number or a condition; only records do;
 * - agents are not ranked against each other, and volume alone is not success.
 */

export type Condition = "verified" | "attention" | "unverified" | "not_connected";
export type Face = "site" | "crew";

export type Ring = { label: string; value: number; goal: number; display: string };

export type Reading = {
  id: string;
  face: Face;
  label: string;
  condition: Condition;
  /** One word for the dial's centre: Verified, Failing, Stale, Idle, Not connected… */
  state: string;
  /** The headline number or short value; null when there is nothing to show. */
  headline: string | null;
  unit: string;
  /** Change since last week, e.g. "+6 this week". */
  change: string | null;
  /** The few facts that matter (integrity lists each required check). */
  facts: string[];
  /** Oldest to newest, for a sparkline; empty when there is no series. */
  trend: number[];
  source: string | null;
  observedAt: string | null;
  /** The reading exists but is out of date (old run, proof older than the code): worth a look. */
  stale?: boolean;
  /** Where "Open evidence" goes. */
  /** The work list or one item; the Site Timeline page (§21) will add a ledger target. */
  evidence: { href: "work" | "workItem"; number?: number; label: string } | null;
  /** Crew face: concentric activity rings. */
  rings?: Ring[];
  /** Crew face: evidence-backed contributions per day, oldest first (28 days). */
  days?: number[];
};

export type Instruments = {
  scope: { kind: "site" } | { kind: "work"; number: number };
  observedAt: string;
  site: Reading[];
  crew: Reading[];
  /** Where the dial rests: what needs attention first. */
  rest: { face: Face; id: string };
};

export type InstrumentsResponse = Instruments & { source: "recorded" | "sample"; siteName: string };

// ── Inputs: plain rows the API reads ─────────────────────────────────────────
export type InstrumentWork = {
  number: number;
  title: string;
  kind: "change" | "install";
  stage: WorkStage;
  complexity: Complexity;
  createdAt: string;
  released: boolean;
  releasedAt: string | null;
  paused: boolean;
  /** The decision waiting on a person, if any, and since when. */
  pending: { title: string; since: string } | null;
};
export type InstrumentEvidence = {
  kind: string;
  ok: boolean;
  commit: string | null;
  passed: number | null;
  failed: number | null;
  total: number | null;
  at: string;
  work: number | null;
  step: string | null;
  detail: Record<string, unknown>;
};
export type InstrumentLedger = {
  at: string;
  kind: string;
  actorKind: "person" | "crew" | "policy" | "system";
  actorLabel: string;
  counts: boolean;
  work: number | null;
  summary: string;
};
export type InstrumentInputs = {
  now: string;
  scope: Instruments["scope"];
  baselineTests: number | null;
  work: InstrumentWork[];
  evidence: InstrumentEvidence[];
  ledger: InstrumentLedger[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STALE_DAYS = 14;
const MIN_RELEASES = 3;

const ms = (iso: string) => Date.parse(iso);
const byTime = <T extends { at: string }>(a: T, b: T) => ms(a.at) - ms(b.at);
const short = (sha: string | null) => (sha ? sha.slice(0, 8) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 min ago", "3 h ago", "2 days ago". */
export function ago(at: string, now: string): string {
  const d = Math.max(0, ms(now) - ms(at));
  if (d < HOUR) return `${Math.max(1, Math.round(d / 60_000))} min ago`;
  if (d < DAY) return `${Math.round(d / HOUR)} h ago`;
  return plural(Math.round(d / DAY), "day") + " ago";
}

/** A duration for people: "45 min", "4.2 h", "3 days". */
export function span(msDuration: number): string {
  if (msDuration < HOUR) return `${Math.max(1, Math.round(msDuration / 60_000))} min`;
  if (msDuration < 2 * DAY) return `${(msDuration / HOUR).toFixed(msDuration < 10 * HOUR ? 1 : 0)} h`;
  return plural(Math.round(msDuration / DAY), "day");
}

/** Counts per day for the last `days` days, oldest first. */
function perDay<T extends { at: string }>(rows: T[], now: string, days: number): number[] {
  const out = Array<number>(days).fill(0);
  const end = ms(now);
  for (const r of rows) {
    const age = Math.floor((end - ms(r.at)) / DAY);
    if (age >= 0 && age < days) out[days - 1 - age]! += 1;
  }
  return out;
}

const notConnected = (id: string, label: string, how: string): Reading => ({
  id, face: "site", label, condition: "not_connected", state: "Not connected", headline: null, unit: "",
  change: null, facts: [how], trend: [], source: null, observedAt: null, evidence: null,
});

const latest = <T extends { at: string }>(rows: T[]) => [...rows].sort(byTime).at(-1) ?? null;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

// ── Site face ────────────────────────────────────────────────────────────────
/**
 * State integrity: the required checks on one candidate. Every step's latest
 * run passed; Prove passed after the last new code; and, once released, the
 * live check passed. New code after Prove makes the proof stale.
 */
function integrity(i: InstrumentInputs, ev: InstrumentEvidence[], scoped: InstrumentWork | null): Reading {
  const base = { id: "integrity", face: "site" as const, label: "State integrity", unit: "required checks", change: null, trend: [] };
  const target =
    scoped ??
    [...i.work].filter((w) => w.kind === "change" && w.released && w.releasedAt).sort((a, b) => ms(a.releasedAt!) - ms(b.releasedAt!)).at(-1) ??
    null;
  if (!target) {
    return {
      ...base, condition: "unverified", state: "Not established", headline: null,
      facts: ["No release has been recorded through the platform yet, so the live state has no checks behind it."],
      source: null, observedAt: null, evidence: { href: "work", label: "Open the work list" },
    };
  }
  const mine = ev.filter((e) => e.work === target.number).sort(byTime);
  const steps = new Map<string, InstrumentEvidence>();
  for (const e of mine) if (e.kind === "step_checks" && e.step) steps.set(e.step, e);
  const lastCode = [...mine].filter((e) => e.kind === "step_checks" && e.commit).at(-1) ?? null;
  const prove = latest(mine.filter((e) => e.kind === "prove"));
  const release = latest(mine.filter((e) => e.kind === "release"));

  const stepsOk = steps.size > 0 && [...steps.values()].every((e) => e.ok);
  const proveFresh = !!prove && (!lastCode || ms(prove.at) >= ms(lastCode.at));
  const checks: { name: string; ok: boolean | null; note: string }[] = [
    {
      name: "Every step's checks",
      ok: steps.size ? stepsOk : null,
      note: steps.size ? `${[...steps.values()].filter((e) => e.ok).length} of ${plural(steps.size, "step")} green` : "no step checks recorded",
    },
    {
      name: "Prove on the candidate",
      ok: prove ? (proveFresh ? prove.ok : null) : null,
      note: !prove ? "not proven yet" : !proveFresh ? "stale: new code since the last Prove" : prove.ok ? `passed on ${short(prove.commit)}` : "failed",
    },
  ];
  if (target.released || release) {
    checks.push({ name: "Live check after release", ok: release ? release.ok : null, note: release ? (release.ok ? "the live site answered" : "needs a look") : "not recorded" });
  }
  const passed = checks.filter((c) => c.ok === true).length;
  const failed = checks.some((c) => c.ok === false);
  const condition: Condition = failed ? "attention" : passed === checks.length ? "verified" : "unverified";
  const newest = latest(mine);
  return {
    ...base,
    condition,
    ...(!!prove && !proveFresh && { stale: true }),
    state: failed ? "Needs a look" : condition === "verified" ? "Verified" : "Incomplete",
    headline: `${passed}/${checks.length}`,
    facts: [
      `${scoped ? "" : "Live: "}#${target.number} ${target.title}`.slice(0, 90),
      ...checks.map((c) => `${c.ok === true ? "✓" : c.ok === false ? "✗" : "○"} ${c.name}: ${c.note}`),
    ].slice(0, 4),
    source: newest ? `${newest.kind.replace("_", " ")} evidence on #${target.number}` : null,
    observedAt: newest?.at ?? null,
    evidence: { href: "workItem", number: target.number, label: `Open #${target.number}` },
  };
}

function tests(i: InstrumentInputs, ev: InstrumentEvidence[]): Reading {
  const base = { id: "tests", face: "site" as const, label: "Tests", unit: "", change: null };
  const runs = ev.filter((e) => e.total != null).sort(byTime);
  const last = runs.at(-1);
  if (!last) {
    return { ...base, condition: "unverified", state: "No runs yet", headline: null, facts: ["No test run has been recorded yet."], trend: [], source: null, observedAt: null, evidence: null };
  }
  const total = last.total!;
  const passed = last.passed ?? total - (last.failed ?? 0);
  const failed = last.failed ?? total - passed;
  const weekAgo = [...runs].filter((r) => ms(r.at) <= ms(i.now) - 7 * DAY).at(-1);
  const grew = weekAgo ? total - weekAgo.total! : null;
  const stale = ms(i.now) - ms(last.at) > STALE_DAYS * DAY;
  const below = i.baselineTests != null && total < i.baselineTests;
  const condition: Condition = failed > 0 || below ? "attention" : stale ? "unverified" : "verified";
  return {
    ...base,
    condition,
    state: failed > 0 ? "Failing" : below ? "Below baseline" : stale ? "Stale" : "Passing",
    headline: String(passed),
    unit: `of ${total} passing`,
    ...(stale && { stale: true }),
    change: grew == null ? null : grew === 0 ? "no change this week" : `${grew > 0 ? "+" : ""}${grew} this week`,
    facts: [
      `${passed} of ${total} passing${failed ? `, ${failed} failing` : ""}${last.commit ? ` on ${short(last.commit)}` : ""}`,
      i.baselineTests != null ? `Suite ${total} against a baseline of ${i.baselineTests}` : "No baseline recorded yet (Checkout records it)",
      `Last run ${ago(last.at, i.now)}${last.work ? ` on #${last.work}` : ""}${stale ? ": older than two weeks" : ""}`,
    ],
    trend: runs.slice(-12).map((r) => r.total!),
    source: `${last.kind === "prove" ? "Prove" : "Step checks"} run`,
    observedAt: last.at,
    evidence: last.work ? { href: "workItem", number: last.work, label: `Open #${last.work}` } : null,
  };
}

function inFlight(i: InstrumentInputs, scoped: InstrumentWork | null): Reading {
  const base = { id: "flight", face: "site" as const, label: "Work in flight", change: null, trend: [] };
  const active = (scoped ? [scoped] : i.work.filter((w) => w.kind === "change")).filter((w) => w.stage !== "done" && w.stage !== "cancelled");
  const waiting = active.filter((w) => w.pending).sort((a, b) => ms(a.pending!.since) - ms(b.pending!.since));
  const oldest = waiting[0];
  const late = !!oldest && ms(i.now) - ms(oldest.pending!.since) > DAY;
  const tiers = (["low", "medium", "high"] as const).map((c) => [c, active.filter((w) => w.complexity === c).length] as const).filter(([, n]) => n);
  const paused = active.filter((w) => w.paused).length;
  return {
    ...base,
    condition: late ? "attention" : "verified",
    state: late ? "Waiting on you" : waiting.length ? "Decision ready" : active.length ? "Moving" : "Clear",
    headline: String(waiting.length),
    unit: waiting.length === 1 ? "decision waiting on you" : "decisions waiting on you",
    facts: [
      active.length ? `${plural(active.length, "active item")}${tiers.length ? `: ${tiers.map(([c, n]) => `${n} ${c}`).join(", ")}` : ""}` : "Nothing in flight",
      oldest ? `Oldest: #${oldest.number} ${oldest.pending!.title}, waiting ${span(ms(i.now) - ms(oldest.pending!.since))}` : "No decision is waiting on you",
      ...(paused ? [`${plural(paused, "item")} paused`] : []),
    ],
    source: "Work records",
    observedAt: i.now,
    evidence: oldest ? { href: "workItem", number: oldest.number, label: `Open #${oldest.number}` } : { href: "work", label: "Open the work list" },
  };
}

/** The DORA keys we can measure from records: lead time, frequency, change-failure rate. */
function delivery(i: InstrumentInputs, ev: InstrumentEvidence[]): Reading {
  const base = { id: "delivery", face: "site" as const, label: "Delivery flow", change: null };
  const since = ms(i.now) - 30 * DAY;
  const releases = ev.filter((e) => e.kind === "release" && ms(e.at) >= since);
  const shipped = i.work.filter((w) => w.released && w.releasedAt && ms(w.releasedAt) >= since);
  const lead = shipped.map((w) => ms(w.releasedAt!) - ms(w.createdAt)).filter((d) => d >= 0);
  const failures = releases.filter((r) => !r.ok).length;
  const n = releases.length;
  const weeks = Array.from({ length: 8 }, (_, k) => {
    const end = ms(i.now) - (7 - k) * 7 * DAY;
    return ev.filter((e) => e.kind === "release" && ms(e.at) > end - 7 * DAY && ms(e.at) <= end).length;
  });
  if (!n) {
    return { ...base, condition: "unverified", state: "No releases yet", headline: null, unit: "", facts: ["No release recorded in the last 30 days."], trend: weeks, source: null, observedAt: null, evidence: { href: "work", label: "Open the work list" } };
  }
  const rate = failures / n;
  const enough = n >= MIN_RELEASES;
  return {
    ...base,
    condition: !enough ? "unverified" : rate > 0.25 ? "attention" : "verified",
    state: !enough ? `Not enough data (${n} of ${MIN_RELEASES})` : rate > 0.25 ? "Unstable" : "Flowing",
    headline: lead.length ? span(median(lead)) : String(n),
    unit: lead.length ? "median lead time" : "releases",
    facts: [
      `${plural(n, "release")} in 30 days`,
      `Change-failure rate ${Math.round(rate * 100)}% (${failures} of ${n})`,
      "Time to restore: not connected yet",
    ],
    trend: weeks,
    source: "Release evidence",
    observedAt: latest(releases)?.at ?? null,
    evidence: { href: "work", label: "Open the work list" },
  };
}

function changes(i: InstrumentInputs, ev: InstrumentEvidence[]): Reading {
  const base = { id: "changes", face: "site" as const, label: "Changes", unit: "commits landed this week" };
  const landed = ev.filter((e) => e.kind === "step_checks" && e.ok && e.commit);
  if (!ev.some((e) => e.kind === "step_checks")) {
    return { ...base, condition: "unverified", state: "None recorded", headline: null, unit: "", change: null, facts: ["No build step has been recorded yet."], trend: [], source: null, observedAt: null, evidence: null };
  }
  const days = perDay(landed, i.now, 14);
  const week = days.slice(7).reduce((a, b) => a + b, 0);
  const before = days.slice(0, 7).reduce((a, b) => a + b, 0);
  const items = new Set(landed.filter((e) => ms(e.at) > ms(i.now) - 7 * DAY).map((e) => e.work)).size;
  const last = latest(landed);
  return {
    ...base,
    condition: "verified",
    state: week ? "Landing" : "Quiet",
    headline: String(week),
    change: `${week - before >= 0 ? "+" : ""}${week - before} vs last week`,
    facts: [
      `${plural(week, "checked commit")} this week across ${plural(items, "item")}`,
      last ? `Last: ${short(last.commit)} ${ago(last.at, i.now)}${last.work ? ` on #${last.work}` : ""}` : "No checked commits yet",
      "Only commits that passed the Protocol count",
    ],
    trend: days,
    source: "Step check evidence",
    observedAt: last?.at ?? null,
    evidence: last?.work ? { href: "workItem", number: last.work, label: `Open #${last.work}` } : null,
  };
}

/** The code census Prove records on each candidate (F3c): size, shape and where complexity concentrates. */
function censusReading(i: InstrumentInputs, ev: InstrumentEvidence[]): Reading {
  const base = { id: "census", face: "site" as const, label: "Code census" };
  const runs = ev.filter((e) => e.kind === "census").sort(byTime).flatMap((e) => {
    const c = readCensus(e.detail);
    return c ? [{ e, c }] : [];
  });
  const last = runs.at(-1);
  if (!last) {
    return {
      ...base, condition: "unverified", state: "Not counted yet", headline: null, unit: "", change: null,
      facts: ["Prove counts functions, components, routes and files on each candidate; none has run since this was connected."],
      trend: [], source: null, observedAt: null, evidence: null,
    };
  }
  const { e, c } = last;
  const weekAgo = [...runs].filter((r) => ms(r.e.at) <= ms(i.now) - 7 * DAY).at(-1);
  const grew = weekAgo ? c.functions - weekAgo.c.functions : null;
  const stale = ms(i.now) - ms(e.at) > STALE_DAYS * DAY;
  const top = c.hotspots[0];
  return {
    ...base,
    condition: stale ? "unverified" : "verified",
    state: stale ? "Stale" : "Counted",
    headline: c.functions.toLocaleString("en-US"),
    unit: "functions",
    change: grew == null ? null : grew === 0 ? "no change this week" : `${grew > 0 ? "+" : ""}${grew} this week`,
    ...(stale && { stale: true }),
    facts: [
      `${plural(c.components, "component")} · ${plural(c.routes, "route")} · ${plural(c.files, "source file")}`,
      `${c.lines.toLocaleString("en-US")} lines of code · ${plural(c.tests, "test file")}`,
      top ? `Most branching: ${top.path} (${top.branches} branch points in ${top.lines} lines)` : "No branching code found",
    ],
    trend: runs.slice(-12).map((r) => r.c.functions),
    source: `Prove on ${short(e.commit) ?? "the candidate"}`,
    observedAt: e.at,
    evidence: e.work ? { href: "workItem", number: e.work, label: `Open #${e.work}` } : null,
  };
}

// ── Crew face ────────────────────────────────────────────────────────────────
export const CREW_FACE = [
  { id: "lead", label: "Team Lead", actor: "Team Lead" },
  { id: "designer", label: "Designer", actor: "Designer" },
  { id: "planner", label: "Planner", actor: "Planner" },
  { id: "builder", label: "Builder", actor: "Builder" },
  { id: "judge", label: "Judge", actor: "Judge" },
  { id: "release", label: "Release", actor: "Release" },
  { id: "people", label: "People", actor: null },
] as const;

/** Entries that are a role's results: counted ones passed; uncounted ones of these kinds failed. */
const RESULT_KINDS = new Set(["step_checks", "prove", "release", "failed"]);

function crewReading(i: InstrumentInputs, ledger: InstrumentLedger[], role: (typeof CREW_FACE)[number]): Reading {
  const mine = ledger.filter((l) => (role.actor ? l.actorKind === "crew" && l.actorLabel === role.actor : l.actorKind === "person"));
  const counted = mine.filter((l) => l.counts);
  const days = perDay(counted, i.now, 28);
  const week = days.slice(21).reduce((a, b) => a + b, 0);
  const pace = days.slice(0, 21).reduce((a, b) => a + b, 0) / 3;
  const goal = Math.max(1, Math.round(pace));
  const results = mine.filter((l) => RESULT_KINDS.has(l.kind) && ms(l.at) > ms(i.now) - 28 * DAY);
  const passed = results.filter((l) => l.counts).length;
  const rate = results.length ? passed / results.length : null;
  const repairs = mine.filter((l) => l.kind === "repair" && ms(l.at) > ms(i.now) - 28 * DAY).length;
  const last = latest(mine);
  const idle = !mine.some((l) => ms(l.at) > ms(i.now) - 28 * DAY);
  const struggling = rate != null && results.length >= 5 && rate < 0.6;
  const people = role.id === "people";
  const rings: Ring[] = [
    { label: people ? "Decisions vs usual pace" : "Work landed vs usual pace", value: week, goal, display: `${week} / ${goal}` },
    ...(people
      ? []
      : [{ label: "First-pass success", value: rate == null ? 0 : Math.round(rate * 100), goal: 100, display: rate == null ? "no results yet" : `${Math.round(rate * 100)}%` }]),
  ];
  return {
    id: role.id,
    face: "crew",
    label: role.label,
    condition: idle ? "unverified" : struggling ? "attention" : "verified",
    state: idle ? "Idle" : struggling ? "Struggling" : "Active",
    headline: String(week),
    unit: people ? "decisions this week" : "contributions this week",
    change: pace ? `usual pace ${pace.toFixed(1)} a week` : null,
    facts: [
      people
        ? `${plural(counted.filter((l) => ms(l.at) > ms(i.now) - 28 * DAY).length, "decision")} in 28 days`
        : rate == null
          ? "No checked results in 28 days"
          : `${passed} of ${results.length} checked results passed in 28 days`,
      ...(people ? [] : [`${plural(repairs, "self-repair")} in 28 days`]),
      last ? `Last: ${last.summary.replace(/\.$/, "").slice(0, 80)} (${ago(last.at, i.now)})` : role.id === "judge" ? "No independent reviews recorded yet" : "No activity recorded yet",
    ],
    trend: days,
    source: "Change Ledger",
    observedAt: last?.at ?? null,
    evidence: { href: "work", label: "Open the work list" },
    rings,
    days,
  };
}

// ── The projection ───────────────────────────────────────────────────────────
/** Every reading for the site or one Work item, and where the dial should rest. */
export function buildInstruments(i: InstrumentInputs): Instruments {
  const scoped = i.scope.kind === "work" ? (i.work.find((w) => w.number === (i.scope as { number: number }).number) ?? null) : null;
  const inScope = <T extends { work: number | null }>(rows: T[]) => (scoped ? rows.filter((r) => r.work === scoped.number) : rows);
  const ev = inScope(i.evidence);
  const ledger = inScope(i.ledger);

  const site: Reading[] = scoped
    ? [integrity(i, ev, scoped), tests(i, ev), inFlight(i, scoped), changes(i, ev), censusReading(i, ev)]
    : [
        integrity(i, ev, null),
        tests(i, ev),
        inFlight(i, null),
        delivery(i, ev),
        changes(i, ev),
        censusReading(i, ev),
        notConnected("lighthouse", "Lighthouse", "Performance, accessibility and SEO scores aren't connected to the cockpit yet."),
        notConnected("uptime", "Uptime", "No production monitor is connected yet."),
        notConnected("errors", "Errors", "Production error logs aren't connected yet."),
        notConnected("budget", "Budget", "Model and service spend isn't recorded yet."),
      ];
  const crew = CREW_FACE.map((r) => crewReading(i, ledger, r));

  // Rest on what needs attention first (site before crew), then on anything stale, otherwise on state integrity.
  // "Idle" or "not enough data yet" are honest but not actionable, so the dial doesn't point at them.
  const pick = [...site, ...crew].find((r) => r.condition === "attention") ?? site.find((r) => r.stale) ?? site[0]!;
  return { scope: i.scope, observedAt: i.now, site, crew, rest: { face: pick.face, id: pick.id } };
}
