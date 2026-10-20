import { isStripeTestKey, mayCall, readCensus, ROLE_VOICE, toolsFor, type JobTokenClaims, type ModelRole, type ToolScope } from "@accelerator/domain";

import { verifyJobToken } from "./job-token";
import { record } from "./ledger";
import { db, rows, type Row } from "./supabase";
import { secretValues } from "./vault";

/**
 * The Toolbelt v0 (gen2-crew.md §1.2, G2.2): an MCP server inside the API.
 * Agents reach it with their job token; the tenant, work item and role come
 * from that token (never from input); tools/list shows only the role's tools,
 * and every call is checked again and audited in acc_tool_calls.
 * Transport: MCP Streamable HTTP, JSON responses (no server-initiated stream).
 */

const PROTOCOL = "2025-06-18";
const MAX_NOTES_PER_JOB = 5;

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: RpcRequest["id"], result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
/** The job's narrowing (G2.2b): its rail stop and the site crew's allowance, both from the token. */
const scopeOf = (c: JobTokenClaims): ToolScope => ({ stage: c.stage ?? null, allowed: c.tools ?? null });
const err = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], ...(isError && { isError: true }) });

/** The caller's claims, if the token is valid and its job is still running under the same claim. */
export async function authenticate(request: Request): Promise<JobTokenClaims | null> {
  return authenticateToken(request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "");
}

/** The same check for a bare token (the model proxy reads it from x-api-key). */
export async function authenticateToken(token: string): Promise<JobTokenClaims | null> {
  const claims = token ? verifyJobToken(token) : null;
  if (!claims) return null;
  const [job] = await rows(db().from("acc_jobs").select("status, generation, site_id").eq("id", claims.jobId));
  if (!job || job.status !== "running" || ((job.generation as number) ?? 0) !== claims.generation || job.site_id !== claims.siteId) return null;
  return claims;
}

/** Handles one JSON-RPC message (or a batch) for an authenticated job. Notifications get no response. */
export async function handleMcp(claims: JobTokenClaims, body: unknown): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(claims, m as RpcRequest)))).filter((r): r is RpcResponse => !!r);
    return out.length ? out : null;
  }
  return one(claims, body as RpcRequest);
}

async function one(claims: JobTokenClaims, m: RpcRequest): Promise<RpcResponse | null> {
  if (!m || typeof m !== "object" || typeof m.method !== "string") return err(null, -32600, "Invalid request.");
  const notification = m.id === undefined;
  switch (m.method) {
    case "initialize":
      return ok(m.id, {
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "accelerator-toolbelt", version: "0.1.0" },
        instructions: `The Accelerator's Toolbelt for ${ROLE_VOICE[claims.role]}: read this Work item's status, history, decisions and evidence${claims.role === "consult" ? "" : ", and post a short note to the person when something matters"}.`,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: toolsFor(claims.role, scopeOf(claims)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": {
      const name = typeof m.params?.name === "string" ? m.params.name : "";
      const args = (m.params?.arguments as Record<string, unknown> | undefined) ?? {};
      return ok(m.id, await callTool(claims, name, args));
    }
    default:
      return notification ? null : err(m.id, -32601, `Unknown method ${m.method}.`);
  }
}

/** One tool call: the role's allowlist is enforced here, whatever was listed, and every call is audited. */
export async function callTool(claims: JobTokenClaims, name: string, args: Record<string, unknown>) {
  const started = Date.now();
  let ok = false;
  let summary = "";
  try {
    if (!mayCall(claims.role, name, scopeOf(claims))) {
      summary = `${name} isn't available to the ${ROLE_VOICE[claims.role]}${claims.stage ? ` at ${claims.stage}` : ""}.`;
      return text(summary, true);
    }
    const result = await runTool(claims, name, args);
    ok = true;
    summary = JSON.stringify(result).slice(0, 300);
    return text(result);
  } catch (e) {
    summary = e instanceof Error ? e.message : "The tool failed.";
    return text(summary, true);
  } finally {
    await audit(claims, name, args, ok, summary, Date.now() - started);
  }
}

async function audit(claims: JobTokenClaims, tool: string, args: Record<string, unknown>, ok: boolean, result: string, ms: number) {
  const input = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v]));
  const { error } = await db().from("acc_tool_calls").insert({
    org_id: claims.orgId, site_id: claims.siteId, work_id: claims.workId, job_id: claims.jobId, role: claims.role, tool, input, ok, result: result.slice(0, 500), ms,
  });
  if (error) console.error("[toolbelt] audit:", error.message);
}

async function runTool(claims: JobTokenClaims, name: string, args: Record<string, unknown>): Promise<unknown> {
  const work = claims.workId ? (await rows(db().from("acc_work").select("*").eq("id", claims.workId).eq("site_id", claims.siteId)))[0] : undefined;
  const needWork = () => {
    if (!work) throw new Error("This job has no Work item.");
    return work;
  };
  switch (name) {
    case "work_status": {
      const w = needWork();
      const steps = await rows(db().from("acc_work_steps").select("position, title, status, attempts").eq("work_id", w.id as string).order("position"));
      return {
        item: `#${w.number} ${w.title}`, stage: w.stage, complexity: w.complexity, paused: !!w.paused_at, plan_approved: !!w.plan_approved_at,
        steps: steps.map((s) => ({ position: s.position, title: s.title, status: s.status, runs: s.attempts })),
        proof: w.proof ? { ok: (w.proof as Row).ok, commit: (w.proof as Row).commit, reasons: (w.proof as Row).reasons } : null,
        released: !!w.released_at,
      };
    }
    case "work_history": {
      const w = needWork();
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 30));
      const entries = await rows(db().from("acc_ledger").select("at, kind, actor_label, summary").eq("work_id", w.id as string).order("at", { ascending: false }).limit(limit));
      return entries.reverse().map((e) => ({ at: e.at, kind: e.kind, by: e.actor_label, what: e.summary }));
    }
    case "work_decisions": {
      const w = needWork();
      const ds = await rows(db().from("acc_decisions").select("created_at, kind, actor_label, via, target, invalidated_at, invalidated_reason").eq("work_id", w.id as string).order("created_at"));
      return ds.map((d) => ({ at: d.created_at, decision: d.kind, by: d.actor_label, via: d.via, on: d.target, voided: d.invalidated_at ? d.invalidated_reason : null }));
    }
    case "evidence_recent": {
      const w = needWork();
      let q = db().from("acc_evidence").select("created_at, kind, ok, commit_sha, passed, failed, total, detail").eq("work_id", w.id as string);
      if (typeof args.kind === "string") q = q.eq("kind", args.kind);
      const ev = await rows(q.order("created_at", { ascending: false }).limit(10));
      return ev.map((e) => ({ at: e.created_at, kind: e.kind, ok: e.ok, commit: e.commit_sha, tests: e.total == null ? null : `${e.passed}/${e.total}`, reasons: (e.detail as Row)?.reasons ?? [] }));
    }
    case "site_census": {
      const [e] = await rows(db().from("acc_evidence").select("created_at, commit_sha, detail").eq("site_id", claims.siteId).eq("kind", "census").order("created_at", { ascending: false }).limit(1));
      const c = e ? readCensus((e.detail as Record<string, unknown>) ?? {}) : null;
      return c ? { at: e!.created_at, commit: e!.commit_sha, ...c } : { note: "No census has been counted yet; Prove counts one on each candidate." };
    }
    case "site_capabilities": {
      const caps = await rows(db().from("acc_capabilities").select("key, area, name, purpose, importance, requirements, paths").eq("site_id", claims.siteId).eq("lifecycle", "accepted"));
      return caps.length
        ? caps.map((c) => ({ key: c.key, area: c.area, name: c.name, purpose: c.purpose, importance: c.importance, requirements: c.requirements, paths: ((c.paths as string[]) ?? []).slice(0, 40) }))
        : { note: "No capabilities are accepted for this site yet." };
    }
    case "stripe_test_catalog": {
      const key = (await secretValues(claims.siteId, "development").catch(() => ({}) as Record<string, string>)).STRIPE_SECRET_KEY;
      if (!key) throw new Error("This site has no Stripe test key (STRIPE_SECRET_KEY under Configuration → development keys).");
      if (!isStripeTestKey(key)) throw new Error("The site's Stripe key isn't a test-mode key; the Toolbelt only uses test mode.");
      const kind = args.kind === "prices" ? "prices" : "products";
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
      const res = await fetch(`https://api.stripe.com/v1/${kind}?limit=${limit}${kind === "products" ? "&active=true" : ""}`, {
        headers: { authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { data?: Row[]; error?: { message?: string }; livemode?: boolean };
      if (!res.ok) throw new Error(`Stripe ${res.status}: ${data.error?.message ?? "request failed"}`);
      const list = (data.data ?? []).filter((x) => x.livemode !== true);
      return kind === "products"
        ? list.map((p) => ({ id: p.id, name: p.name, description: p.description, default_price: p.default_price, metadata: p.metadata }))
        : list.map((p) => ({ id: p.id, product: p.product, currency: p.currency, unit_amount: p.unit_amount, recurring: p.recurring, nickname: p.nickname }));
    }
    case "rail_note": {
      const w = needWork();
      const note = typeof args.note === "string" ? args.note.trim().slice(0, 1200) : "";
      if (!note) throw new Error("Write the note.");
      const posted = await rows(db().from("acc_tool_calls").select("id").eq("job_id", claims.jobId).eq("tool", "rail_note").eq("ok", true));
      if (posted.length >= MAX_NOTES_PER_JOB) throw new Error(`Only ${MAX_NOTES_PER_JOB} notes per run; keep the person's conversation focused.`);
      const label = `${ROLE_VOICE[claims.role]} (note)`;
      const { error } = await db().from("acc_work_messages").insert({ org_id: w.org_id, work_id: w.id, author_kind: "model", author_label: label, stage: w.stage, body: note });
      if (error) throw new Error(error.message);
      await record(w, { kind: "note", actor: { kind: "crew", label: ROLE_VOICE[claims.role as ModelRole] }, summary: note.slice(0, 200), refs: { job: claims.jobId } });
      return { ok: true, note: "Posted to the person's conversation." };
    }
    default:
      throw new Error(`There's no tool called ${name}.`);
  }
}
