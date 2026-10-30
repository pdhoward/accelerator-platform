import {
  applyRuling,
  assembleBook,
  findings,
  isDomain,
  mergeIngest,
  packFor,
  readiness,
  type Conflict,
  type CradleResponse,
  type Domain,
  type Identity,
  type IngestReport,
  type Ruling,
  type Site,
  type SitePolicy,
} from "@accelerator/domain";

import { MACHINE_SHOP_INGEST, MACHINE_SHOP_INGEST_SCRIPT } from "./cradle-sample";
import { CodeError } from "./codes";
import { db, rows, type Row } from "./supabase";

/**
 * Gen 3, the Cradle (gen3-cradle.md): a site's policy book on the server. The
 * pack lives in code; the site's layer is versioned rows in acc_cradle_nodes,
 * contradictions are acc_cradle_edges. The keyless demo keeps the same state in
 * memory and simulates the ingest from a real reading of Machine Shop.
 */

export type CradleEvent = { id: number; at: string; kind: "status" | "tool" | "log" | "check"; text: string };

const now = () => new Date().toISOString();
const lowerOf = (range: unknown) => String(range ?? "").match(/^[[(]"?([^",]+)"?,/)?.[1] ?? now();

function respond(domain: Domain | null, cradle: CradleResponse["cradle"], site: SitePolicy[], conflicts: Conflict[], ingest: CradleResponse["ingest"]): CradleResponse {
  const pack = packFor(cradle?.pack ?? domain);
  if (!cradle || !pack) return { cradle: null, pack, book: [], conflicts: [], findings: [], readiness: null, ingest };
  const book = assembleBook(pack, site);
  const found = findings(pack, book, conflicts);
  return { cradle, pack, book, conflicts, findings: found, readiness: readiness(book, found), ingest };
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
  const [[c], [s], layer, conflicts, [job]] = await Promise.all([
    rows(db().from("acc_cradles").select("*").eq("site_id", site.id)),
    rows(db().from("acc_sites").select("domain").eq("id", site.id)),
    siteLayer(site.id),
    conflictsOf(site.id),
    rows(db().from("acc_jobs").select("id, status, error, created_at, result").eq("site_id", site.id).eq("kind", "ingest").order("created_at", { ascending: false }).limit(1)),
  ]);
  const cradle = c ? { pack: c.pack as Domain, packVersion: c.pack_version as string, startedAt: c.started_at as string, startedBy: (c.started_label as string) ?? null, ingestedAt: (c.ingested_at as string) ?? null } : null;
  const ingest = job ? { status: job.status as "queued", jobId: job.id as string, startedAt: job.created_at as string, error: (job.error as string) ?? null, summary: (((job.result as Row)?.report as Row)?.summary as string) ?? null } : null;
  return respond(isDomain(s?.domain) ? s!.domain : null, cradle, layer, conflicts, ingest);
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

export async function rulePolicy(site: Site, identity: Identity, name: string, key: string, ruling: Ruling) {
  const [c] = await rows(db().from("acc_cradles").select("pack").eq("site_id", site.id));
  const pack = packFor(isDomain(c?.pack) ? c!.pack : null);
  if (!pack) throw new CodeError("This site has no cradle yet.");
  const current = (await siteLayer(site.id)).find((p) => p.key === key);
  await writeVersion(site, applyRuling(pack, current, key, ruling, name, now()), { id: identity.userId, label: name });
}

export async function resolveConflict(site: Site, name: string, id: string, ruling: string) {
  const [e] = await rows(db().from("acc_cradle_edges").select("body").eq("site_id", site.id).eq("id", id));
  if (!e) throw new CodeError("No such contradiction.");
  await db().from("acc_cradle_edges").update({ status: "resolved", body: { ...(e.body as Row), ruling, ruledBy: name, ruledAt: now() } }).eq("id", id);
}

export async function ingestEvents(site: Site, jobId: string, after: number): Promise<CradleEvent[]> {
  const [job] = await rows(db().from("acc_jobs").select("id").eq("id", jobId).eq("site_id", site.id));
  if (!job) return [];
  const ev = await rows(db().from("acc_job_events").select("id, at, kind, text").eq("job_id", jobId).gt("id", after).order("id").limit(500));
  return ev.map((e) => ({ id: e.id as number, at: e.at as string, kind: e.kind as CradleEvent["kind"], text: e.text as string }));
}

// ── The keyless demo: the same flow, in memory ───────────────────────────────

type DemoState = { cradle: CradleResponse["cradle"]; layer: SitePolicy[]; conflicts: Conflict[]; ingest: { startedAt: number; done: boolean } | null };
const g = globalThis as unknown as { __cradleDemo?: Map<string, DemoState> };
const demoStates: Map<string, DemoState> = (g.__cradleDemo ??= new Map<string, DemoState>());
/** The demo's ingest takes the script's length at real speed. */
const DEMO_INGEST_MS = (MACHINE_SHOP_INGEST_SCRIPT.at(-1)!.s + 2) * 1000;

function demoState(site: Site): DemoState {
  let s = demoStates.get(site.id);
  if (!s) demoStates.set(site.id, (s = { cradle: null, layer: [], conflicts: [], ingest: null }));
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
  return { ...respond("commerce", s.cradle, s.layer, s.conflicts, ingest), sample: true };
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
    const next = applyRuling(pack, s.layer.find((p) => p.key === input.key), input.key, input.ruling, name, now());
    s.layer = [...s.layer.filter((p) => p.key !== input.key), next];
  } else if (input.action === "resolve") {
    s.conflicts = s.conflicts.map((c) => (c.id === input.id ? { ...c, status: "resolved", ruling: input.ruling } : c));
  }
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
  | { action: "reset" };
