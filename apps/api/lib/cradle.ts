import {
  alignmentRequest,
  applyRuling,
  assembleBook,
  findings,
  holePolicy,
  isDomain,
  mergeIngest,
  packFor,
  readiness,
  type AlignDecision,
  type Alignment,
  type BookPolicy,
  type Caller,
  type Conflict,
  type CradleResponse,
  type Domain,
  type Identity,
  type IngestReport,
  type Pack,
  type Ruling,
  type Site,
  type SitePolicy,
} from "@accelerator/domain";

import { MACHINE_SHOP_INGEST, MACHINE_SHOP_INGEST_SCRIPT } from "./cradle-sample";
import { CodeError } from "./codes";
import { db, rows, type Row } from "./supabase";
import { createWork, postMessage } from "./work";

/**
 * Gen 3, the Cradle (gen3-cradle.md): a site's policy book on the server. The
 * pack lives in code; the site's layer is versioned rows in acc_cradle_nodes,
 * contradictions are acc_cradle_edges. The keyless demo keeps the same state in
 * memory and simulates the ingest from a real reading of Machine Shop.
 */

export type CradleEvent = { id: number; at: string; kind: "status" | "tool" | "log" | "check"; text: string };

const now = () => new Date().toISOString();
const lowerOf = (range: unknown) => String(range ?? "").match(/^[[(]"?([^",]+)"?,/)?.[1] ?? now();

function respond(domain: Domain | null, cradle: CradleResponse["cradle"], site: SitePolicy[], conflicts: Conflict[], ingest: CradleResponse["ingest"], alignments: Alignment[] = []): CradleResponse {
  const pack = packFor(cradle?.pack ?? domain);
  if (!cradle || !pack) return { cradle: null, pack, book: [], conflicts: [], findings: [], readiness: null, alignments: [], ingest };
  const book = assembleBook(pack, site);
  const found = findings(pack, book, conflicts);
  return { cradle, pack, book, conflicts, findings: found, readiness: readiness(book, found), alignments, ingest };
}

// ── The database ─────────────────────────────────────────────────────────────

async function siteLayer(siteId: string): Promise<SitePolicy[]> {
  const all = await rows(db().from("acc_cradle_nodes").select("key, version, body").eq("site_id", siteId).eq("kind", "policy").order("version"));
  const latest = new Map<string, Row>();
  for (const r of all) latest.set(r.key as string, r);
  return [...latest.values()].map((r) => ({ ...(r.body as SitePolicy), key: r.key as string, version: r.version as number }));
}

async function conflictsOf(siteId: string): Promise<Conflict[]> {
  const edges = await rows(db().from("acc_cradle_edges").select("id, status, body").eq("site_id", siteId).eq("kind", "conflicts_with").order("created_at"));
  return edges.map((e) => ({ ...(e.body as Omit<Conflict, "id" | "status">), id: e.id as string, status: e.status as Conflict["status"] }));
}

export async function readCradle(site: Site): Promise<CradleResponse> {
  const [[c], [s], layer, conflicts, alignments, [job]] = await Promise.all([
    rows(db().from("acc_cradles").select("*").eq("site_id", site.id)),
    rows(db().from("acc_sites").select("domain").eq("id", site.id)),
    siteLayer(site.id),
    conflictsOf(site.id),
    alignmentsOf(site.id),
    rows(db().from("acc_jobs").select("id, status, error, created_at, result").eq("site_id", site.id).eq("kind", "ingest").order("created_at", { ascending: false }).limit(1)),
  ]);
  const cradle = c ? { pack: c.pack as Domain, packVersion: c.pack_version as string, startedAt: c.started_at as string, startedBy: (c.started_label as string) ?? null, ingestedAt: (c.ingested_at as string) ?? null } : null;
  const ingest = job ? { status: job.status as "queued", jobId: job.id as string, startedAt: job.created_at as string, error: (job.error as string) ?? null, summary: (((job.result as Row)?.report as Row)?.summary as string) ?? null } : null;
  return respond(isDomain(s?.domain) ? s!.domain : null, cradle, layer, conflicts, ingest, alignments);
}

/** Start the cradle from an industry pack: the scaffold, before anything is ingested. */
export async function startCradle(site: Site, identity: Identity, name: string, pack: Domain): Promise<void> {
  const p = packFor(pack)!;
  await db().from("acc_sites").update({ domain: pack }).eq("id", site.id);
  const { error } = await db().from("acc_cradles").upsert({ site_id: site.id, org_id: site.orgId, pack, pack_version: p.version, started_by: identity.userId, started_label: name, started_at: now() });
  if (error) throw new Error(error.message);
}

/** Write a new version of a site policy: close the one in force, then open the next. */
async function writeVersion(site: Pick<Site, "id" | "orgId">, row: SitePolicy, by: { id: string | null; label: string }) {
  const at = now();
  const [cur] = await rows(db().from("acc_cradle_nodes").select("id, effective, version").eq("site_id", site.id).eq("key", row.key).order("version", { ascending: false }).limit(1));
  if (cur) await db().from("acc_cradle_nodes").update({ effective: `[${lowerOf(cur.effective)},${at})` }).eq("id", cur.id as string);
  const version = Math.max(row.version, ((cur?.version as number) ?? 0) + 1);
  const { error } = await db().from("acc_cradle_nodes").insert({
    org_id: site.orgId, site_id: site.id, kind: "policy", key: row.key, version, effective: `[${at},)`,
    criticality: row.criticality ?? null, binding: row.binding, extraction_status: row.extraction ?? null, business_status: row.status,
    body: { ...row, version }, created_by: by.id, created_label: by.label,
  });
  if (error) throw new Error(error.message);
}

/** The runner's report lands on the site's layer (lib/work.ts finish). Nothing is confirmed by it. */
export async function applyIngest(site: Pick<Site, "id" | "orgId">, report: IngestReport) {
  const [c] = await rows(db().from("acc_cradles").select("pack").eq("site_id", site.id));
  const pack = packFor(isDomain(c?.pack) ? c!.pack : null);
  if (!pack) throw new CodeError("Start the cradle before ingesting.");
  const existing = await siteLayer(site.id);
  const { policies, conflicts } = mergeIngest(pack, existing, report);
  for (const p of policies) await writeVersion(site, p, { id: null, label: "Policy Extractor" });
  const open = await conflictsOf(site.id);
  const seen = new Set(open.map((x) => [...x.keys].sort().join("|")));
  const fresh = conflicts.filter((x) => !seen.has([...x.keys].sort().join("|")));
  if (fresh.length) {
    await db().from("acc_cradle_edges").insert(fresh.map((x) => ({ org_id: site.orgId, site_id: site.id, kind: "conflicts_with", src_key: x.keys[0], dst_key: x.keys[1] ?? x.keys[0], status: "open", body: { keys: x.keys, why: x.why, kind: x.kind } })));
  }
  await db().from("acc_cradles").update({ ingested_at: now() }).eq("site_id", site.id);
  return { policies: policies.length, conflicts: fresh.length };
}

async function packOf(siteId: string): Promise<Pack> {
  const [c] = await rows(db().from("acc_cradles").select("pack").eq("site_id", siteId));
  const pack = packFor(isDomain(c?.pack) ? c!.pack : null);
  if (!pack) throw new CodeError("This site has no cradle yet.");
  return pack;
}

/** A ruling on one policy. Restating, retiring or changing a value goes to the crew; confirming what the code does doesn't. */
export async function rulePolicy(site: Site, identity: Identity, caller: Caller, key: string, ruling: Ruling) {
  const pack = await packOf(site.id);
  const layer = await siteLayer(site.id);
  const book = assembleBook(pack, layer);
  const before = book.find((p) => p.key === key);
  await writeVersion(site, applyRuling(pack, layer.find((p) => p.key === key), key, ruling, caller.name, now()), { id: identity.userId, label: caller.name });
  if (ruling.action === "confirm" || ruling.action === "dispute") return;
  const sentence =
    ruling.action === "restate" ? ruling.statement : ruling.action === "set" ? `${Object.entries(ruling.parameters).map(([k, v]) => `${k} = ${v}`).join(", ")}. ${ruling.reason}` : ruling.reason;
  const context = ruling.action === "retire" ? `Retire "${before?.title ?? key}": the site must stop doing this. ${before?.statement ?? ""}`.trim() : `${before?.title ?? key}: ${before?.statement ?? ""}`;
  await align(site, identity, caller, pack, book, { decision: ruling.action, sentence, keys: [key], concepts: before ? [before.concept] : [], context });
}

/** A ruling on a contradiction: it becomes precedent, and the crew brings the code into line with it. */
export async function resolveConflict(site: Site, identity: Identity, caller: Caller, id: string, ruling: string) {
  const [e] = await rows(db().from("acc_cradle_edges").select("body").eq("site_id", site.id).eq("id", id));
  if (!e) throw new CodeError("No such contradiction.");
  await db().from("acc_cradle_edges").update({ status: "resolved", body: { ...(e.body as Row), ruling, ruledBy: caller.name, ruledAt: now() } }).eq("id", id);
  await alignConflict(site, identity, caller, { ...(e.body as Omit<Conflict, "id" | "status">), id, status: "resolved", ruling });
}

async function alignConflict(site: Site, identity: Identity, caller: Caller, c: Conflict) {
  const pack = await packOf(site.id);
  const book = assembleBook(pack, await siteLayer(site.id));
  const titles = c.keys.map((k) => book.find((p) => p.key === k)?.title ?? k).join(" vs ");
  const concepts = [...new Set(c.keys.map((k) => book.find((p) => p.key === k)?.concept).filter((x): x is string => !!x))];
  await align(site, identity, caller, pack, book, { decision: "ruling", sentence: c.ruling ?? "", keys: c.keys, concepts, context: `${titles}. ${c.why}`, conflictId: c.id });
}

/** Rulings made before alignment existed (or whose work item was closed unfinished): send them to the crew now. */
export async function alignOpenRulings(site: Site, identity: Identity, caller: Caller) {
  const sent = new Set((await alignmentsOf(site.id)).filter((a) => a.work && a.work.stage !== "cancelled").map((a) => a.conflictId));
  for (const c of (await conflictsOf(site.id)).filter((c) => c.status === "resolved" && c.ruling && !sent.has(c.id))) await alignConflict(site, identity, caller, c);
}

/** The steward fills a hole with a policy in a sentence; the crew checks the code follows it. */
export async function fillHole(site: Site, identity: Identity, caller: Caller, concept: string, event: string, statement: string) {
  const pack = await packOf(site.id);
  const layer = await siteLayer(site.id);
  const row = holePolicy(pack, layer, concept, event, statement, caller.name, now());
  await writeVersion(site, row, { id: identity.userId, label: caller.name });
  const book = assembleBook(pack, [...layer, row]);
  await align(site, identity, caller, pack, book, { decision: "new", sentence: statement, keys: [row.key], concepts: [concept], context: `A new policy for ${row.title!.toLowerCase()}, where the book had none.` });
}

// ── Alignment: each decision rides a work item (decision nodes in acc_cradle_nodes) ─

type AlignInput = { decision: AlignDecision; sentence: string; keys: string[]; concepts: string[]; context: string; conflictId?: string };
type StoredAlignment = Alignment & { risk: string[]; workNumber: number | null };

async function alignmentsOf(siteId: string): Promise<StoredAlignment[]> {
  const nodes = await rows(db().from("acc_cradle_nodes").select("key, body").eq("site_id", siteId).eq("kind", "decision").order("created_at"));
  const list = nodes.filter((n) => (n.body as Row)?.type === "alignment").map((n) => ({ ...(n.body as StoredAlignment), id: n.key as string }));
  const numbers = [...new Set(list.map((a) => a.workNumber).filter((n): n is number => n != null))];
  const work = numbers.length ? await rows(db().from("acc_work").select("number, stage, released_at").eq("site_id", siteId).in("number", numbers)) : [];
  const byNumber = new Map(work.map((w) => [w.number as number, { number: w.number as number, stage: w.stage as string, released: !!w.released_at }]));
  return list.map((a) => ({ ...a, work: (a.workNumber != null && byNumber.get(a.workNumber)) || null })).reverse();
}

async function align(site: Site, identity: Identity, caller: Caller, pack: Pack, book: BookPolicy[], input: AlignInput) {
  const req = alignmentRequest(pack, book, input);
  const existing = await alignmentsOf(site.id);
  // A decision on the same policies while their work item is still open joins it, so two items never race on one change.
  const open = existing.find(
    (a) =>
      a.work && !a.work.released && a.work.stage !== "done" && a.work.stage !== "cancelled" && a.risk.join() === req.risk.join() &&
      (a.keys.some((k) => input.keys.includes(k)) || a.concepts.some((c) => input.concepts.includes(c))),
  );
  let workNumber: number;
  if (open?.work) {
    workNumber = open.work.number;
    await postMessage(site, identity, { name: caller.name, role: caller.role, member: caller.via === "member" }, workNumber, `Another decision on the same policies:\n\n${req.message}`);
  } else {
    workNumber = (await createWork(site, identity, caller.name, { title: req.title, message: req.message, risk: req.risk })).number;
  }
  const at = now();
  const { error } = await db().from("acc_cradle_nodes").insert({
    org_id: site.orgId, site_id: site.id, kind: "decision", key: `ALIGN-${existing.length + 1}`, version: 1, effective: `[${at},)`,
    body: { type: "alignment", decision: input.decision, sentence: input.sentence, keys: input.keys, concepts: input.concepts, context: input.context, conflictId: input.conflictId ?? null, risk: req.risk, by: caller.name, at, workNumber },
    created_by: identity.userId, created_label: caller.name,
  });
  if (error) throw new Error(error.message);
}

export async function ingestEvents(site: Site, jobId: string, after: number): Promise<CradleEvent[]> {
  const [job] = await rows(db().from("acc_jobs").select("id").eq("id", jobId).eq("site_id", site.id));
  if (!job) return [];
  const ev = await rows(db().from("acc_job_events").select("id, at, kind, text").eq("job_id", jobId).gt("id", after).order("id").limit(500));
  return ev.map((e) => ({ id: e.id as number, at: e.at as string, kind: e.kind as CradleEvent["kind"], text: e.text as string }));
}

// ── The keyless demo: the same flow, in memory ───────────────────────────────

type DemoState = { cradle: CradleResponse["cradle"]; layer: SitePolicy[]; conflicts: Conflict[]; alignments: Alignment[]; ingest: { startedAt: number; done: boolean } | null };
const g = globalThis as unknown as { __cradleDemo?: Map<string, DemoState> };
const demoStates: Map<string, DemoState> = (g.__cradleDemo ??= new Map<string, DemoState>());
/** The demo's ingest takes the script's length at real speed. */
const DEMO_INGEST_MS = (MACHINE_SHOP_INGEST_SCRIPT.at(-1)!.s + 2) * 1000;

function demoState(site: Site): DemoState {
  let s = demoStates.get(site.id);
  if (!s) demoStates.set(site.id, (s = { cradle: null, layer: [], conflicts: [], alignments: [], ingest: null }));
  if (s.ingest && !s.ingest.done && Date.now() - s.ingest.startedAt >= DEMO_INGEST_MS) {
    const pack = packFor(s.cradle!.pack)!;
    const merged = mergeIngest(pack, s.layer, MACHINE_SHOP_INGEST);
    const byKey = new Map<string, SitePolicy>(s.layer.map((p: SitePolicy) => [p.key, p]));
    for (const p of merged.policies) byKey.set(p.key, p);
    s.layer = [...byKey.values()];
    s.conflicts = [...s.conflicts, ...merged.conflicts.map((c, i) => ({ ...c, id: `demo-${s!.conflicts.length + i + 1}` }))];
    s.cradle = { ...s.cradle!, ingestedAt: new Date().toISOString() };
    s.ingest.done = true;
  }
  return s;
}

export function demoCradle(site: Site): CradleResponse {
  const s = demoState(site);
  const ingest = s.ingest ? { status: s.ingest.done ? ("done" as const) : ("running" as const), jobId: "demo", startedAt: new Date(s.ingest.startedAt).toISOString(), error: null, summary: s.ingest.done ? MACHINE_SHOP_INGEST.summary : null } : null;
  return { ...respond("commerce", s.cradle, s.layer, s.conflicts, ingest, s.alignments), sample: true };
}

export function demoAction(site: Site, name: string, input: DemoInput) {
  const s = demoState(site);
  if (input.action === "reset") return void demoStates.delete(site.id);
  if (input.action === "start") {
    const p = packFor(input.pack)!;
    s.cradle = { pack: input.pack, packVersion: p.version, startedAt: now(), startedBy: name, ingestedAt: null };
    return;
  }
  if (!s.cradle) throw new CodeError("Start the cradle first.");
  const pack = packFor(s.cradle.pack)!;
  if (input.action === "ingest") {
    if (s.ingest && !s.ingest.done) throw new CodeError("The crew is already reading the site.");
    s.ingest = { startedAt: Date.now(), done: false };
  } else if (input.action === "rule") {
    const before = assembleBook(pack, s.layer).find((p) => p.key === input.key);
    const next = applyRuling(pack, s.layer.find((p) => p.key === input.key), input.key, input.ruling, name, now());
    s.layer = [...s.layer.filter((p) => p.key !== input.key), next];
    const r = input.ruling;
    if (r.action === "restate" || r.action === "retire" || r.action === "set") {
      demoAlign(s, name, { decision: r.action, sentence: r.action === "restate" ? r.statement : r.reason, keys: [input.key], concepts: before ? [before.concept] : [], context: before?.title ?? input.key });
    }
  } else if (input.action === "resolve") {
    s.conflicts = s.conflicts.map((c) => (c.id === input.id ? { ...c, status: "resolved", ruling: input.ruling } : c));
    const c = s.conflicts.find((x) => x.id === input.id);
    if (c) demoAlign(s, name, { decision: "ruling", sentence: input.ruling, keys: c.keys, concepts: [], context: c.why });
  } else if (input.action === "fill") {
    const row = holePolicy(pack, s.layer, input.concept, input.event, input.statement, name, now());
    s.layer = [...s.layer, row];
    demoAlign(s, name, { decision: "new", sentence: input.statement, keys: [row.key], concepts: [input.concept], context: row.title! });
  }
}

/** The demo records the decision; with no crew to run it has no work item. */
function demoAlign(s: DemoState, by: string, a: Omit<Alignment, "id" | "by" | "at" | "work">) {
  s.alignments = [{ ...a, id: `ALIGN-${s.alignments.length + 1}`, by, at: now(), work: null }, ...s.alignments];
}

export function demoEvents(site: Site, after: number): CradleEvent[] {
  const s = demoState(site);
  if (!s.ingest) return [];
  const elapsed = (Date.now() - s.ingest.startedAt) / 1000;
  return MACHINE_SHOP_INGEST_SCRIPT.map((e, i) => ({ id: i + 1, at: new Date(s.ingest!.startedAt + e.s * 1000).toISOString(), kind: e.kind, text: e.text })).filter((e, i) => e.id > after && MACHINE_SHOP_INGEST_SCRIPT[i]!.s <= elapsed);
}

export type DemoInput =
  | { action: "start"; pack: Domain }
  | { action: "ingest" }
  | { action: "rule"; key: string; ruling: Ruling }
  | { action: "resolve"; id: string; ruling: string }
  | { action: "fill"; concept: string; event: string; statement: string }
  | { action: "align" }
  | { action: "reset" };
