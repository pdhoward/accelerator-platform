import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gunzipSync } from "node:zlib";
import type { Identity, LeadStreamEvent, Site } from "@accelerator/domain";

/**
 * Stage 2 and 3 in the API (gen2-crew.md §17 F4, §1.2, §14, §18, §21): the
 * streamed lead, the Toolbelt, reliable claims, the land lock, document
 * versions and retention, against the in-memory database.
 */
vi.mock("./supabase", async () => (await import("./testing/fake-db")).fakeSupabase);

import { signJobToken, verifyJobToken } from "./job-token";
import { runRetention } from "./retention";
import { fakeDb, resetFakeDb, table } from "./testing/fake-db";
import { authenticate, callTool, handleMcp } from "./toolbelt";
import { claim, finish, renewClaim, saveDesign, settleLapsed, streamReply, workFingerprint, type Speaker } from "./work";

const site = { id: "site-a", orgId: "org-a", name: "Machine Shop" } as Site;
const owner = { userId: "owner-a", email: "owner@example.test" } as Identity;
const ownerSpeaks: Speaker = { name: "Patrick", role: "owner", member: true };
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const job = (extra: Record<string, unknown>) => ({ org_id: "org-a", site_id: "site-a", work_id: "work-3", role: "build", provider: "anthropic", model: "m", created_by: "owner-a", generation: 0, attempts: 0, ...extra });

beforeEach(() => {
  vi.stubEnv("TOOLBELT_SECRET", "test-toolbelt-secret");
  resetFakeDb({
    acc_orgs: [{ id: "org-a" }],
    acc_sites: [{ id: "site-a", org_id: "org-a", slug: "machineshop", name: "Machine Shop", url: "https://shop.test" }],
    acc_work: [{
      id: "work-3", org_id: "org-a", site_id: "site-a", number: 3, kind: "change", title: "Faster quote form", stage: "build", risk: [], complexity: "low",
      ready_at: "x", plan_approved_at: "x", created_at: iso(120), updated_at: iso(60),
    }],
    acc_work_messages: [{ id: "m1", work_id: "work-3", author_kind: "person", author_label: "Patrick", body: "Make it faster.", created_at: iso(119) }],
    acc_work_steps: [{ id: "s1", work_id: "work-3", position: 1, title: "Speed up", detail: "", status: "todo", attempts: 0 }],
    acc_jobs: [],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("job tokens", () => {
  const claims = { jobId: "j1", orgId: "org-a", siteId: "site-a", workId: "work-3", role: "build" as const, generation: 2, exp: Date.now() + 60_000 };
  it("round-trip, and refuse tampering and expiry", () => {
    const t = signJobToken(claims);
    expect(verifyJobToken(t)).toEqual(claims);
    const [payload, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, siteId: "site-b" })).toString("base64url");
    expect(verifyJobToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyJobToken(`${payload}.x${mac!.slice(1)}`)).toBeNull();
    expect(verifyJobToken(signJobToken({ ...claims, exp: Date.now() - 1 }))).toBeNull();
  });
});

describe("reliable claims (§14.1) and the land lock (§18)", () => {
  it("claims with a new generation, an expiry and a Toolbelt token; renews only the current generation", async () => {
    table("acc_jobs").push(job({ id: "j1", kind: "build_step", status: "queued", input: { stepId: "s1" }, created_at: iso(1) }));
    const ctx = (await claim("runner-1"))!;
    expect(ctx.job.generation).toBe(1);
    expect(verifyJobToken(ctx.toolbeltToken!)).toMatchObject({ jobId: "j1", siteId: "site-a", workId: "work-3", role: "build", generation: 1 });
    expect(table("acc_jobs")[0]).toMatchObject({ status: "running", attempts: 1, generation: 1 });
    expect(Date.parse(table("acc_jobs")[0]!.claim_expires_at as string)).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(await renewClaim("j1", 1)).toBe(true);
    expect(await renewClaim("j1", 0)).toBe(false);
  });

  it("requeues a lapsed job once, then gives up; a stale worker's result is refused", async () => {
    table("acc_jobs").push(job({ id: "j1", kind: "build_step", status: "running", input: { stepId: "s1" }, generation: 1, attempts: 1, claim_expires_at: iso(1), created_at: iso(5) }));
    table("acc_work_steps")[0]!.status = "running";
    await settleLapsed();
    expect(table("acc_jobs")[0]).toMatchObject({ status: "queued", runner_id: null });
    expect(table("acc_work_steps")[0]!.status).toBe("todo");
    // Claimed again (generation 2); the first worker comes back late with its result.
    await claim("runner-2");
    await expect(finish("j1", { status: "failed", error: "late", generation: 1 })).rejects.toThrow("handed to another worker");
    // The second claim lapses too: given up.
    Object.assign(table("acc_jobs")[0]!, { claim_expires_at: iso(1) });
    await settleLapsed();
    expect(table("acc_jobs")[0]).toMatchObject({ status: "failed", outcome_unknown: false });
    expect(table("acc_work_steps")[0]!.status).toBe("blocked");
  });

  it("records a lapsed release's outcome as unknown and never retries it", async () => {
    table("acc_jobs").push(job({ id: "r1", kind: "release", status: "running", generation: 1, attempts: 1, claim_expires_at: iso(1), created_at: iso(5) }));
    await settleLapsed();
    expect(table("acc_jobs")[0]).toMatchObject({ status: "failed", outcome_unknown: true });
    expect(table("acc_work_messages").at(-1)!.body).toContain("Check main and the live site before releasing again");
    expect(table("acc_ledger").at(-1)).toMatchObject({ kind: "outcome_unknown" });
  });

  it("lands one release per site at a time", async () => {
    table("acc_jobs").push(
      job({ id: "r-running", kind: "release", status: "running", generation: 1, claim_expires_at: new Date(Date.now() + 60_000).toISOString(), created_at: iso(3) }),
      job({ id: "r-waiting", kind: "release", status: "queued", work_id: "work-4", created_at: iso(2) }),
      job({ id: "other", kind: "discuss", role: "consult", status: "queued", created_at: iso(1) }),
    );
    const ctx = await claim("runner-1");
    expect(ctx?.job.id).toBe("other");
    expect(table("acc_jobs").find((j) => j.id === "r-waiting")!.status).toBe("queued");
  });
});

describe("the Toolbelt (§1.2)", () => {
  const running = () => table("acc_jobs").push(job({ id: "j1", kind: "build_step", status: "running", generation: 1, created_at: iso(1) }));
  const req = (token: string) => new Request("http://api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const claimsFor = (role: "build" | "consult", generation = 1) => ({ jobId: "j1", orgId: "org-a", siteId: "site-a", workId: "work-3", role, generation, exp: Date.now() + 60_000 });

  it("admits only a valid token for a job still running under the same claim", async () => {
    running();
    expect(await authenticate(req(signJobToken(claimsFor("build"))))).toMatchObject({ role: "build" });
    expect(await authenticate(req(signJobToken(claimsFor("build", 0))))).toBeNull(); // superseded generation
    expect(await authenticate(req("garbage"))).toBeNull();
    table("acc_jobs")[0]!.status = "done";
    expect(await authenticate(req(signJobToken(claimsFor("build"))))).toBeNull();
  });

  it("speaks MCP: initialize, a role's tool list, and no reply to notifications", async () => {
    running();
    const init = (await handleMcp(claimsFor("consult"), { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("accelerator-toolbelt");
    expect(await handleMcp(claimsFor("consult"), { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = (await handleMcp(claimsFor("consult"), { jsonrpc: "2.0", id: 2, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).not.toContain("rail_note");
  });

  it("enforces the allowlist on every call, whatever was listed, and audits it", async () => {
    running();
    const refused = await callTool(claimsFor("consult"), "rail_note", { note: "hi" });
    expect(refused).toMatchObject({ isError: true });
    const status = await callTool(claimsFor("build"), "work_status", {});
    expect(JSON.parse(status.content[0]!.text)).toMatchObject({ item: "#3 Faster quote form", complexity: "low" });
    expect(table("acc_tool_calls").map((c) => [c.role, c.tool, c.ok])).toEqual([["consult", "rail_note", false], ["build", "work_status", true]]);
    expect(table("acc_tool_calls")[0]).toMatchObject({ org_id: "org-a", site_id: "site-a", job_id: "j1" });
  });

  it("lets a working role post a note to the person, a few times per run at most", async () => {
    running();
    for (let k = 0; k < 5; k++) expect((await callTool(claimsFor("build"), "rail_note", { note: `Finding ${k}` })).isError).toBeUndefined();
    expect(table("acc_work_messages").at(-1)).toMatchObject({ author_kind: "model", author_label: "Builder (note)", body: "Finding 4" });
    expect(await callTool(claimsFor("build"), "rail_note", { note: "One too many" })).toMatchObject({ isError: true });
  });
});

describe("the streamed lead reply (§17 F4)", () => {
  const anthropicStream = (chunks: string[]) =>
    vi.fn(async () => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const t of chunks) c.enqueue(enc.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } })}\n\n`));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

  it("streams the words, hides the assessment, records the reply and moves the crew on", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubGlobal("fetch", anthropicStream(["Low: I'll ", "fix it now.\nCOMPLEX", "ITY: low\nREADY: yes\nREASON: One file."]));
    const events: LeadStreamEvent[] = [];
    await streamReply(site, owner, ownerSpeaks, 3, "Also make the button bigger.", undefined, (e) => events.push(e));
    const shown = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
    expect(shown).toBe("Low: I'll fix it now.\n");
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(table("acc_work_messages").at(-1)).toMatchObject({ author_kind: "model", body: "Low: I'll fix it now." });
    const reply = table("acc_jobs").find((j) => j.kind === "discuss")!;
    expect(reply).toMatchObject({ status: "done", runner_id: "api-stream" });
    // The crew carries on: the Low item's step is queued for the runner.
    expect(table("acc_jobs").at(-1)).toMatchObject({ kind: "build_step", status: "queued" });
  });

  it("handles typed commands without calling the model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const events: LeadStreamEvent[] = [];
    await streamReply(site, owner, ownerSpeaks, 3, "stop", undefined, (e) => events.push(e));
    expect(events).toEqual([{ type: "handled", note: "The crew is paused." }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the runner when the API has no Anthropic key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const events: LeadStreamEvent[] = [];
    await streamReply(site, owner, ownerSpeaks, 3, "How's it going?", undefined, (e) => events.push(e));
    expect(events).toEqual([{ type: "queued", note: "The lead will answer shortly." }]);
    expect(table("acc_jobs").at(-1)).toMatchObject({ kind: "discuss", status: "queued" });
  });
});

describe("pushed updates (§17 F4)", () => {
  it("changes its fingerprint when a message, job or step changes", async () => {
    const a = await workFingerprint("site-a", 3);
    expect(await workFingerprint("site-a", 3)).toBe(a);
    table("acc_work_messages").push({ id: "m2", work_id: "work-3", author_kind: "person", body: "x", created_at: iso(0) });
    const b = await workFingerprint("site-a", 3);
    expect(b).not.toBe(a);
    table("acc_work_steps")[0]!.status = "running";
    expect(await workFingerprint("site-a", 3)).not.toBe(b);
  });
});

describe("documents with versions (T3) and retention (T4)", () => {
  it("dual-writes each design version with its hash", async () => {
    Object.assign(table("acc_work")[0]!, { complexity: "medium", plan_approved_at: null });
    await saveDesign(site, owner, "Patrick", 3, "# Brief\n\n## Summary\nFaster.");
    expect(table("acc_documents")[0]).toMatchObject({ work_id: "work-3", kind: "brief", title: "Faster quote form" });
    expect(table("acc_document_versions")[0]).toMatchObject({ version: 1, author_kind: "person", bytes: 27 });
    expect(table("acc_document_versions")[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("archives old logs to storage, deletes expired archives and prunes old drafts, recording each", async () => {
    const day = 86_400_000;
    table("acc_jobs").push(job({ id: "old", kind: "build_step", status: "done", finished_at: new Date(Date.now() - 40 * day).toISOString() }));
    table("acc_job_events").push({ id: 1, job_id: "old", at: iso(1), kind: "log", text: "built it" }, { id: 2, job_id: "old", at: iso(1), kind: "check", text: "tests green" });
    table("acc_log_archives").push({ id: "a-old", org_id: "org-a", site_id: "site-a", job_id: "ancient", storage_key: "org/org-a/site/site-a/jobs/ancient.ndjson.gz", archived_at: new Date(Date.now() - 400 * day).toISOString(), deleted_at: null });
    fakeDb.storage["accelerator-logs/org/org-a/site/site-a/jobs/ancient.ndjson.gz"] = Buffer.from("x");
    table("acc_retention").push({ org_id: "org-a", drafts_kept: 1, logs_hot_days: 30, logs_retention_days: 365, artifacts_retention_days: 365 });
    table("acc_documents").push({ id: "doc", org_id: "org-a", site_id: "site-a", work_id: "work-3", kind: "brief", title: "Faster quote form" });
    for (const v of [1, 2, 3, 4, 5]) table("acc_document_versions").push({ id: `v${v}`, document_id: "doc", org_id: "org-a", version: v, body: `v${v}`, approved_at: v === 1 ? "x" : null, pruned_at: null });
    table("acc_decisions").push({ org_id: "org-a", work_id: "work-3", target: "brief v2" });

    const report = await runRetention();
    expect(report).toEqual({ archived: 1, deletedArchives: 1, prunedDrafts: 1, errors: [] });
    // Logs: moved to storage as gzipped NDJSON, and gone from the database.
    const key = "accelerator-logs/org/org-a/site/site-a/jobs/old.ndjson.gz";
    expect(gunzipSync(fakeDb.storage[key]!).toString("utf8").split("\n").map((l) => JSON.parse(l).text)).toEqual(["built it", "tests green"]);
    expect(table("acc_job_events")).toHaveLength(0);
    expect(table("acc_log_archives").find((a) => a.job_id === "old")).toMatchObject({ events: 2 });
    // The expired archive: removed from storage, marked deleted.
    expect(fakeDb.storage["accelerator-logs/org/org-a/site/site-a/jobs/ancient.ndjson.gz"]).toBeUndefined();
    expect(table("acc_log_archives").find((a) => a.id === "a-old")!.deleted_at).toBeTruthy();
    // Drafts: v1 approved, v2 named by a decision and v5 current always stay; drafts_kept = 1 keeps v4 and prunes v3.
    expect(table("acc_document_versions").filter((v) => v.pruned_at).map((v) => v.id)).toEqual(["v3"]);
    expect(table("acc_document_versions").find((v) => v.id === "v3")!.body).toBeNull();
    expect(table("acc_ledger").at(-1)).toMatchObject({ kind: "pruned", summary: 'Drafts v3 of the brief "Faster quote form" pruned under drafts kept = 1.' });
  });
});
