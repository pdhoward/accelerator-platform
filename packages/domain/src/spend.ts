/**
 * The spend scorecard: what a site's AI work costs, and which work costs it.
 * Three sources, kept apart so nothing is counted twice:
 * - crew: the runner's jobs (reading code, planning, building, proving code), each with its cost;
 * - app: the running app's own model calls (searches, compiling the rules, the assistant), reported by the app;
 * - proofs: the conformance gate's runs, each with its cost.
 * Pure: the API gathers, this sums.
 */

export type SpendArea = "crew" | "app" | "proofs";

/** One model's share of a job (the runner reports it per model since B20; older jobs have none). */
export type SpendMeter = { model: string; tokensIn: number; tokensOut: number; costUsd: number };
export type SpendJob = { id: string; kind: string; model: string; costUsd: number | null; at: string; status: string; workNumber: number | null; title: string | null; meter?: SpendMeter[] | null };
export type SpendUsage = { role: string; model: string; tokensIn: number; tokensOut: number; costUsd: number; at: string };
export type SpendProof = { version: string; at: string; costUsd: number; status: string };

/** latestUsd: the newest unit's cost, so a change (a cheaper way of reading code) shows at once instead of hiding in the average. */
export type SpendLine = { area: SpendArea; key: string; label: string; count: number; costUsd: number; perUnitUsd: number; latestUsd: number; latestAt: string; tokensIn: number; tokensOut: number };

export type SpendScorecard = {
  since: string;
  days: number;
  totalUsd: number;
  todayUsd: number;
  last7Usd: number;
  byArea: { area: SpendArea; label: string; costUsd: number; share: number }[];
  /** What the money went on, most expensive first. */
  lines: SpendLine[];
  byModel: { model: string; costUsd: number; tokensIn: number; tokensOut: number }[];
  /** One row per day, oldest first. */
  daily: ({ day: string } & Record<SpendArea, number>)[];
  /** The most expensive single jobs. */
  topJobs: (SpendJob & { label: string })[];
  /** Gaps in the meter, in plain words. */
  notes: string[];
};

export const AREA_LABEL: Record<SpendArea, string> = { crew: "The crew's work", app: "The running app", proofs: "Proving the rules" };

const JOB_LABEL: Record<string, string> = {
  ingest: "Reading the code (ingest)",
  discuss: "Conversations with the Team Lead",
  design: "Designing changes",
  plan: "Planning changes",
  build_step: "Building changes",
  prove: "Proving code changes",
  release: "Releasing",
  checkout: "Checking out code",
};
const APP_LABEL: Record<string, string> = {
  search: "Shopper searches",
  compile: "Compiling the rules",
  assistant: "Assistant replies",
  voice: "Voice sessions",
};
export const jobLabel = (kind: string) => JOB_LABEL[kind] ?? kind;
export const appLabel = (role: string) => APP_LABEL[role] ?? role;

const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;
const dayOf = (iso: string) => iso.slice(0, 10);

export function spendScorecard(input: { jobs: SpendJob[]; usage: SpendUsage[]; proofs: SpendProof[]; days: number; now?: Date }): SpendScorecard {
  const now = input.now ?? new Date();
  const start = new Date(now.getTime() - (input.days - 1) * 86_400_000);
  const since = `${dayOf(start.toISOString())}T00:00:00.000Z`;
  const inWindow = (at: string) => at >= since;
  const jobs = input.jobs.filter((j) => inWindow(j.at));
  const usage = input.usage.filter((u) => inWindow(u.at));
  const proofs = input.proofs.filter((p) => inWindow(p.at));

  // Every charge as one entry: area, line, model, tokens, cost, when.
  type Entry = { area: SpendArea; key: string; label: string; model: string; tokensIn: number; tokensOut: number; costUsd: number; at: string };
  const entries: Entry[] = [
    ...jobs.map((j) => ({ area: "crew" as const, key: `crew:${j.kind}`, label: jobLabel(j.kind), model: j.model, tokensIn: 0, tokensOut: 0, costUsd: j.costUsd ?? 0, at: j.at })),
    ...usage.map((u) => ({ area: "app" as const, key: `app:${u.role}`, label: appLabel(u.role), model: u.model, tokensIn: u.tokensIn, tokensOut: u.tokensOut, costUsd: u.costUsd, at: u.at })),
    ...proofs.map((p) => ({ area: "proofs" as const, key: "proofs:run", label: "Conformance gate runs", model: "(several)", tokensIn: 0, tokensOut: 0, costUsd: p.costUsd, at: p.at })),
  ];

  const lineMap = new Map<string, SpendLine>();
  for (const e of entries) {
    const l = lineMap.get(e.key) ?? { area: e.area, key: e.key, label: e.label, count: 0, costUsd: 0, perUnitUsd: 0, latestUsd: 0, latestAt: "", tokensIn: 0, tokensOut: 0 };
    l.count++;
    l.costUsd += e.costUsd;
    l.tokensIn += e.tokensIn;
    l.tokensOut += e.tokensOut;
    if (e.at >= l.latestAt) Object.assign(l, { latestAt: e.at, latestUsd: e.costUsd });
    lineMap.set(e.key, l);
  }
  const lines = [...lineMap.values()]
    .map((l) => ({ ...l, costUsd: round(l.costUsd), perUnitUsd: l.count ? round(l.costUsd / l.count, 5) : 0, latestUsd: round(l.latestUsd, 5) }))
    .sort((a, b) => b.costUsd - a.costUsd || a.label.localeCompare(b.label));

  const totalUsd = round(entries.reduce((s, e) => s + e.costUsd, 0));
  const areas: SpendArea[] = ["crew", "app", "proofs"];
  const byArea = areas.map((area) => {
    const costUsd = round(entries.filter((e) => e.area === area).reduce((s, e) => s + e.costUsd, 0));
    return { area, label: AREA_LABEL[area], costUsd, share: totalUsd ? Math.round((costUsd / totalUsd) * 100) : 0 };
  });

  // By model: a metered job splits across the models it used (Sonnet reading, Opus reconciling); an older job counts whole under its own model.
  const modelEntries = [
    ...jobs.flatMap((j) => (j.meter?.length ? j.meter : [{ model: j.model, tokensIn: 0, tokensOut: 0, costUsd: j.costUsd ?? 0 }])),
    ...entries.filter((x) => x.area === "app"),
  ];
  const modelMap = new Map<string, { model: string; costUsd: number; tokensIn: number; tokensOut: number }>();
  for (const e of modelEntries) {
    const m = modelMap.get(e.model) ?? { model: e.model, costUsd: 0, tokensIn: 0, tokensOut: 0 };
    m.costUsd += e.costUsd;
    m.tokensIn += e.tokensIn;
    m.tokensOut += e.tokensOut;
    modelMap.set(e.model, m);
  }
  const byModel = [...modelMap.values()].map((m) => ({ ...m, costUsd: round(m.costUsd) })).sort((a, b) => b.costUsd - a.costUsd);

  const daily: SpendScorecard["daily"] = [];
  for (let i = 0; i < input.days; i++) {
    const day = dayOf(new Date(start.getTime() + i * 86_400_000).toISOString());
    const row = { day, crew: 0, app: 0, proofs: 0 };
    for (const e of entries) if (dayOf(e.at) === day) row[e.area] += e.costUsd;
    daily.push({ day, crew: round(row.crew), app: round(row.app), proofs: round(row.proofs) });
  }
  const today = dayOf(now.toISOString());
  const week = dayOf(new Date(now.getTime() - 6 * 86_400_000).toISOString());

  const topJobs = jobs
    .filter((j) => (j.costUsd ?? 0) > 0)
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))
    .slice(0, 10)
    .map((j) => ({ ...j, label: jobLabel(j.kind) }));

  const notes: string[] = [];
  const unmetered = jobs.filter((j) => j.costUsd == null && (j.status === "done" || j.status === "failed")).length;
  if (unmetered) notes.push(`${unmetered} finished crew job${unmetered === 1 ? "" : "s"} reported no cost (cancelled mid-run, or a runner that predates metering).`);
  if (!input.usage.length) notes.push("The running app hasn't reported its own model use yet. Searches, rule compiles and the assistant appear here once it does.");

  return {
    since,
    days: input.days,
    totalUsd,
    todayUsd: round(daily.filter((d) => d.day === today).reduce((s, d) => s + d.crew + d.app + d.proofs, 0)),
    last7Usd: round(daily.filter((d) => d.day >= week).reduce((s, d) => s + d.crew + d.app + d.proofs, 0)),
    byArea,
    lines,
    byModel,
    daily,
    topJobs,
    notes,
  };
}
