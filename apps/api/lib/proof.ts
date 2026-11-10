import { CRADLE_MARK, proofOutcome, proofScorecard, runtimeBook, type CaseResult, type Proof, type ProofRun, type ProofScorecard, type RuntimeBook, type RuntimeResponse, type Scenario, type Site } from "@accelerator/domain";

import { readCradle } from "./cradle";
import { mintRuntimeToken } from "./runtime";
import { secretValues } from "./vault";
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

/**
 * The proof scorecard (B7): every finished proof run (each version of each
 * PROOF-<book version> node), scored against the live book. One read of the
 * graph plus the cradle; nothing is stored.
 */
export async function scorecard(site: Site): Promise<ProofScorecard | null> {
  const r = await readCradle(site);
  if (!r.cradle) return null;
  const book = runtimeBook(r, { id: site.id, name: site.name });
  const all = await rows(db().from("acc_cradle_nodes").select("key, version, body").eq("site_id", site.id).eq("kind", "decision").like("key", "PROOF-%").order("version"));
  const runs = all.map((x) => x.body as ProofRun).filter((b) => b && (b.status === "passed" || b.status === "failed") && Array.isArray(b.results));
  const [scenarios, inForce] = await Promise.all([scenariosOf(site.id), inForceOf(site.id)]);
  const openConflicts = r.conflicts.filter((c) => c.status === "open").map((c) => ({ id: c.id, keys: c.keys, why: c.why }));
  return proofScorecard({ scenarios, runs, book, inForce: inForce?.version ?? null, openConflicts });
}

const STALE_MS = 10 * 60_000;

/** The app starts proving a version: refused while another proof of it is running (one runner at a time). */
export async function startProof(site: Site, version: string): Promise<boolean> {
  const p = await proofOf(site.id, version);
  if (p?.status === "running" && Date.now() - Date.parse(p.at) < STALE_MS) return false;
  if (p?.status === "passed") return false; // a failed or requested proof may run again
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

/**
 * The app couldn't reach its model mid-proof (B18): nothing was judged, so the
 * version is neither passed nor failed. The safety net tries it again once the
 * proof has sat blocked for a while; model health shows why.
 */
export async function blockProof(site: Site, version: string, reason: string) {
  const p = await proofOf(site.id, version);
  if (p?.status === "passed") return;
  await write(site, `PROOF-${version}`, { type: "proof", bookVersion: version, at: now(), status: "blocked", blockedBy: reason.slice(0, 200), results: [], passed: 0, total: 0, costUsd: 0 }, "app agent");
}

/** The steward asks for the newest rules to be proven again (after reviewing the scenarios). */
export async function requestProof(site: Site, by: string) {
  const res = await runtimeResponse(site);
  if (!res) throw new Error("This site has no cradle.");
  if (res.inForce?.version === res.version) return;
  await write(site, `PROOF-${res.version}`, { type: "proof", bookVersion: res.version, at: now(), status: "requested", results: res.proof?.results ?? [], passed: 0, total: 0, costUsd: 0 }, by);
}

/** The steward approves or retires a scenario. */
export async function setScenarioStatus(site: Site, id: string, status: Scenario["status"], by: string) {
  const s = (await scenariosOf(site.id)).find((x) => x.id === id);
  if (!s) throw new Error("No such scenario.");
  await write(site, id, { type: "scenario", ...s, status }, by);
}

// ── Proving when the rules change (push), and the safety net (cron) ──────────

/**
 * Tell the site's app to prove its newest rules now, instead of waiting for
 * the next page view. The app's address and Vercel's protection bypass (for
 * preview deployments behind Vercel's sign-in) are engine keys in the site's
 * vault: CRADLE_APP_URL and VERCEL_PROTECTION_BYPASS. Never throws: a missed
 * nudge is picked up by the cron safety net or the next page view.
 */
export async function nudgeApp(site: Pick<Site, "id">, reason: string): Promise<"sent" | "no app address" | "failed"> {
  try {
    const engine = await secretValues(site.id, "engine");
    const url = engine.CRADLE_APP_URL?.replace(/\/+$/, "");
    if (!url) return "no app address";
    const res = await fetch(`${url}/api/cradle/prove`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mintRuntimeToken(site.id)}`,
        "content-type": "application/json",
        ...(engine.VERCEL_PROTECTION_BYPASS ? { "x-vercel-protection-bypass": engine.VERCEL_PROTECTION_BYPASS } : {}),
      },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`[proof] nudge ${site.id}: the app answered ${res.status}`);
    return res.ok ? "sent" : "failed";
  } catch (err) {
    console.error(`[proof] nudge ${site.id}:`, err instanceof Error ? err.message : err);
    return "failed";
  }
}

/** The safety net: every site whose newest rules aren't in force and aren't proven, failed or freshly running gets a nudge. */
export async function nudgeWaiting(): Promise<{ checked: number; nudged: string[] }> {
  const cradles = await rows(db().from("acc_cradles").select("site_id"));
  const nudged: string[] = [];
  for (const c of cradles) {
    const [s] = await rows(db().from("acc_sites").select("id, org_id, name, slug").eq("id", c.site_id as string));
    if (!s) continue;
    const site = { id: s.id as string, orgId: s.org_id as string, name: s.name as string, slug: s.slug as string } as Site;
    const res = await runtimeResponse(site).catch(() => null);
    if (!res || res.inForce?.version === res.version) continue;
    const p = res.proof;
    const waiting = !p || p.status === "requested" || ((p.status === "running" || p.status === "blocked") && Date.now() - Date.parse(p.at) > STALE_MS);
    if (waiting && (await nudgeApp(site, "safety net")) === "sent") nudged.push(site.slug);
  }
  return { checked: cradles.length, nudged };
}
