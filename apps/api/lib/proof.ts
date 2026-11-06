import { CRADLE_MARK, proofOutcome, runtimeBook, type CaseResult, type Proof, type RuntimeBook, type RuntimeResponse, type Scenario, type Site } from "@accelerator/domain";

import { readCradle } from "./cradle";
import { db, rows, type Row } from "./supabase";

/**
 * The conformance gate's records (backlog B5), kept in the graph as decision
 * nodes: scenarios (SCN-n), proofs (PROOF-<book version>) and the version in
 * force (INFORCE). Each is versioned like a policy, so the history shows when
 * a rule change was proven, held or promoted.
 */

const now = () => new Date().toISOString();
type Kind = "scenario" | "proof" | "inforce";

async function current(siteId: string, type: Kind): Promise<Row[]> {
  const all = await rows(db().from("acc_cradle_nodes").select("key, version, body, created_at").eq("site_id", siteId).eq("kind", "decision").order("version"));
  const latest = new Map<string, Row>();
  for (const r of all) if ((r.body as Row)?.type === type) latest.set(r.key as string, r);
  return [...latest.values()];
}

/** Write the next version of a decision node: close the one in force, then open the new one. */
async function write(site: Pick<Site, "id" | "orgId">, key: string, body: Row, label: string) {
  const at = now();
  const [prev] = await rows(db().from("acc_cradle_nodes").select("id, version").eq("site_id", site.id).eq("key", key).order("version", { ascending: false }).limit(1));
  if (prev) await db().from("acc_cradle_nodes").update({ effective: `[${(await openedAt(prev.id as string)) ?? at},${at})` }).eq("id", prev.id as string);
  const { error } = await db().from("acc_cradle_nodes").insert({
    org_id: site.orgId, site_id: site.id, kind: "decision", key, version: ((prev?.version as number) ?? 0) + 1, effective: `[${at},)`, body, created_label: label,
  });
  if (error) throw new Error(error.message);
}

async function openedAt(id: string): Promise<string | null> {
  const [r] = await rows(db().from("acc_cradle_nodes").select("effective").eq("id", id));
  return String(r?.effective ?? "").match(/^[[(]"?([^",]+)"?,/)?.[1] ?? null;
}

export async function scenariosOf(siteId: string): Promise<Scenario[]> {
  return (await current(siteId, "scenario")).map((r) => ({ ...(r.body as Scenario), id: r.key as string })).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}

async function proofOf(siteId: string, version: string): Promise<Proof | null> {
  const [r] = (await current(siteId, "proof")).filter((x) => x.key === `PROOF-${version}`);
  return r ? (r.body as Proof) : null;
}

async function inForceOf(siteId: string): Promise<RuntimeResponse["inForce"]> {
  const [r] = await current(siteId, "inforce");
  return r ? { version: (r.body as Row).version as string, at: (r.body as Row).at as string, book: (r.body as Row).book as RuntimeBook } : null;
}

export async function runtimeResponse(site: Site): Promise<RuntimeResponse | null> {
  const r = await readCradle(site);
  if (!r.cradle) return null;
  const live = runtimeBook(r, { id: site.id, name: site.name });
  const [scenarios, inForce, proof] = await Promise.all([scenariosOf(site.id), inForceOf(site.id), proofOf(site.id, live.version)]);
  return { ...live, mark: CRADLE_MARK, scenarios: scenarios.filter((s) => s.status !== "retired"), inForce, proof };
}

/** The steward's view: what is in force, what is being proven, and every scenario. */
export async function compliance(site: Site) {
  const res = await runtimeResponse(site);
  if (!res) return null;
  const all = await scenariosOf(site.id);
  return { live: res.version, inForce: res.inForce ? { version: res.inForce.version, at: res.inForce.at } : null, proof: res.proof, scenarios: all };
}

const STALE_MS = 10 * 60_000;

/** The app starts proving a version: refused while another proof of it is running (one runner at a time). */
export async function startProof(site: Site, version: string): Promise<boolean> {
  const p = await proofOf(site.id, version);
  if (p?.status === "running" && Date.now() - Date.parse(p.at) < STALE_MS) return false;
  if (p?.status === "passed") return false;
  await write(site, `PROOF-${version}`, { type: "proof", bookVersion: version, at: now(), status: "running", results: [], passed: 0, total: 0, costUsd: 0 }, "app agent");
  return true;
}

/** New scenarios the crew drafted: stored as drafts (the steward approves or retires them); duplicates by title are skipped. */
export async function addScenarios(site: Site, drafts: Omit<Scenario, "id" | "status">[]): Promise<Scenario[]> {
  const existing = await scenariosOf(site.id);
  const titles = new Set(existing.map((s) => s.title.trim().toLowerCase()));
  let n = existing.reduce((m, s) => Math.max(m, Number(s.id.slice(4)) || 0), 0);
  const added: Scenario[] = [];
  for (const d of drafts.slice(0, 20)) {
    if (titles.has(d.title.trim().toLowerCase())) continue;
    titles.add(d.title.trim().toLowerCase());
    const s: Scenario = { ...d, id: `SCN-${++n}`, status: "draft" };
    await write(site, s.id, { type: "scenario", ...s }, "crew");
    added.push(s);
  }
  return added;
}

/** The proof's outcome. A pass on the live version puts that version in force. */
export async function finishProof(site: Site, version: string, results: CaseResult[], costUsd: number): Promise<{ status: "passed" | "failed"; promoted: boolean }> {
  const res = await runtimeResponse(site);
  if (!res) throw new Error("This site has no cradle.");
  const outcome = proofOutcome(res.scenarios, results);
  await write(site, `PROOF-${version}`, { type: "proof", bookVersion: version, at: now(), status: outcome.status, results: results.slice(0, 200), passed: outcome.passed, total: outcome.total, costUsd }, "app agent");
  const promoted = outcome.status === "passed" && version === res.version;
  if (promoted) {
    const { mark: _m, scenarios: _s, inForce: _i, proof: _p, ...book } = res;
    await write(site, "INFORCE", { type: "inforce", version, at: now(), book }, "conformance gate");
  }
  return { status: outcome.status, promoted };
}

/** The steward approves or retires a scenario. */
export async function setScenarioStatus(site: Site, id: string, status: Scenario["status"], by: string) {
  const s = (await scenariosOf(site.id)).find((x) => x.id === id);
  if (!s) throw new Error("No such scenario.");
  await write(site, id, { type: "scenario", ...s, status }, by);
}
