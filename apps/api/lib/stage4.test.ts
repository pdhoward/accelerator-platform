import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity, Site } from "@accelerator/domain";

/**
 * Stage 4 and 5 in the API (gen2-crew.md §2, §10, §20, G2.2b–G2.6): the crew
 * as configuration, mandates and budgets, handoffs, the capability inventory,
 * the Skillsmith, the Library, Boarding and the model proxy, against the
 * in-memory database.
 */
vi.mock("./supabase", async () => (await import("./testing/fake-db")).fakeSupabase);
vi.mock("./github", () => ({
  repoPaths: async () => ["app/page.tsx", "lib/catalog.ts", "components/search-box.tsx", "lib/product.ts", "lib/product.test.ts", "app/p/[id]/page.tsx"],
}));

import { readBoarding } from "./boarding";
import { readCapabilities, reviewCapability, surveyCapabilities } from "./capabilities";
import { crewContext, decideProposal, listProposals, proposeSkill, runSkillsmith, saveCrew } from "./crew";
import { verifyJobToken } from "./job-token";
import { exportSite, saveInterview, siteInterview, timeline } from "./library";
import { currentMandate, saveMandate } from "./mandate";
import { proxyModel } from "./model-proxy";
import { resetFakeDb, table } from "./testing/fake-db";
import { handleMcp } from "./toolbelt";
import { claim, finish, workDetail } from "./work";

const site = { id: "site-a", orgId: "org-a", slug: "machineshop", name: "Machine Shop", url: "https://shop.test", repo: "pdhoward/machineshop" } as Site;
const owner = { userId: "owner-a", email: "owner@example.test" } as Identity;
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const job = (extra: Record<string, unknown>) => ({ org_id: "org-a", site_id: "site-a", work_id: "work-3", role: "build", provider: "anthropic", model: "m", created_by: "owner-a", generation: 0, attempts: 0, ...extra });

beforeEach(() => {
  vi.stubEnv("TOOLBELT_SECRET", "test-toolbelt-secret");
  resetFakeDb({
    acc_orgs: [{ id: "org-a", partner_id: "partner-h" }],
    acc_sites: [{ id: "site-a", org_id: "org-a", slug: "machineshop", name: "Machine Shop", url: "https://shop.test", domain: "commerce", docs_sync: true, repo: "pdhoward/machineshop" }],
    acc_work: [{
      id: "work-3", org_id: "org-a", site_id: "site-a", number: 3, kind: "change", title: "Search by brand", stage: "build", risk: [], complexity: "low",
      ready_at: "x", plan_approved_at: "x", created_at: iso(120), updated_at: iso(60),
    }],
    acc_work_messages: [{ id: "m1", work_id: "work-3", author_kind: "person", author_label: "Patrick", body: "Let people search by brand.", created_at: iso(119) }],
    acc_work_steps: [{ id: "s1", work_id: "work-3", position: 1, title: "Brand search", detail: "", status: "todo", attempts: 0 }],
    acc_jobs: [],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The lead answers; the crew goes on to build (Low), which is where handoffs and budgets bite. */
async function leadAnswers() {
  table("acc_jobs").push(job({ id: "j-lead", kind: "discuss", role: "consult", status: "running", generation: 1, created_at: iso(2) }));
  await finish("j-lead", { status: "done", result: { kind: "discuss", reply: "On it." }, generation: 1, costUsd: 0.42 });
}

describe("the crew as configuration (G2.3)", () => {
  it("versions the crew and refuses switching off a safety skill or widening a tool", async () => {
    await expect(saveCrew(site, owner, "Patrick", { disabledSkills: ["crew.test-data"] })).rejects.toThrow("safety skill");
    await expect(saveCrew(site, owner, "Patrick", { tools: { lead: ["rail_note"] } })).rejects.toThrow("never widen");
    expect(await saveCrew(site, owner, "Patrick", { tools: { builder: ["work_status", "rail_note"] }, disabledSkills: ["crew.small-steps"] }, "Narrow the Builder")).toEqual({ version: 1 });
    expect(await saveCrew(site, owner, "Patrick", { disabledSkills: [] })).toEqual({ version: 2 });
    expect(table("acc_ledger").filter((e) => e.kind === "crew")).toHaveLength(2);
  });

  it("gives each job its specialist, assembled skills (crew, domain, site) and the narrowed tools in its token", async () => {
    await saveCrew(site, owner, "Patrick", { tools: { builder: ["work_status", "rail_note"] } });
    const p = await proposeSkill(site, owner, "Patrick", { title: "Machine Shop catalog rules", body: "Read-only MongoDB; always paginate.", specialist: "builder", scope: "site" });
    await decideProposal(site, owner, "Patrick", p.id, "approve");
    const crew = await crewContext({ id: "site-a", orgId: "org-a", domain: "commerce" }, "build_step");
    expect(crew).toMatchObject({ specialist: "builder", label: "Builder", crewVersion: 1, tools: ["work_status", "rail_note"] });
    expect(crew.skills.map((s) => s.tier)).toEqual(expect.arrayContaining(["crew", "domain", "site"]));

    table("acc_jobs").push(job({ id: "j1", kind: "build_step", status: "queued", input: { stepId: "s1" }, created_at: iso(1) }));
    const ctx = (await claim("runner-1"))!;
    expect(ctx.crew?.skills.some((s) => s.title === "Machine Shop catalog rules")).toBe(true);
    expect(verifyJobToken(ctx.toolbeltToken!)).toMatchObject({ stage: "build", tools: ["work_status", "rail_note"] });
    const listed = (await handleMcp(verifyJobToken(ctx.toolbeltToken!)!, { jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((t) => t.name)).toEqual(["work_status", "rail_note"]);
    const refused = (await handleMcp(verifyJobToken(ctx.toolbeltToken!)!, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "work_history" } })) as { result: { isError?: boolean } };
    expect(refused.result.isError).toBe(true);
  });

  it("records an audited handoff and the crew version on each job, and the run's cost", async () => {
    await saveCrew(site, owner, "Patrick", {});
    await leadAnswers();
    const build = table("acc_jobs").find((j) => j.kind === "build_step")!;
    expect(build).toMatchObject({ crew_version: 1, mandate_version: null });
    expect(table("acc_jobs").find((j) => j.id === "j-lead")!.cost_usd).toBe(0.42);
    expect(table("acc_ledger").find((e) => e.kind === "handoff")?.summary).toBe("Team Lead → Builder: build the next step.");
  });
});

describe("mandates and budgets (§10.1)", () => {
  const mandate = { outcome: "Visitors find products by brand.", acceptance: ["Searching a brand lists only its products"], budgetUsd: 1 };

  it("versions the mandate as a decision and voids the release approvals a material change affects", async () => {
    expect((await saveMandate(site, owner, "Patrick", 3, mandate)).version).toBe(1);
    table("acc_decisions").push({ id: "d-ship", org_id: "org-a", site_id: "site-a", work_id: "work-3", kind: "ship", actor_kind: "person", actor_label: "Patrick", created_at: iso(1) });
    await saveMandate(site, owner, "Patrick", 3, { ...mandate, budgetUsd: 2 }); // not material
    expect(table("acc_decisions").find((d) => d.id === "d-ship")!.invalidated_at).toBeUndefined();
    await saveMandate(site, owner, "Patrick", 3, { ...mandate, acceptance: [...mandate.acceptance, "Works on phones"] });
    expect(table("acc_decisions").find((d) => d.id === "d-ship")!.invalidated_reason).toMatch(/the mandate changed \(v3: acceptance criteria, budget\)/);
    expect((await currentMandate("work-3"))!.version).toBe(3);
    await expect(saveMandate(site, owner, "Patrick", 3, { outcome: "x" })).rejects.toThrow("acceptance criterion");
  });

  it("stops the crew at the budget instead of spending more, and says how to go on", async () => {
    await saveMandate(site, owner, "Patrick", 3, mandate);
    table("acc_jobs").push(job({ id: "j-old", kind: "design", status: "done", cost_usd: 1.5, created_at: iso(50) }));
    await leadAnswers();
    expect(table("acc_jobs").some((j) => j.kind === "build_step")).toBe(false);
    expect(table("acc_work")[0]!.paused_at).toBeTruthy();
    expect(table("acc_work_messages").at(-1)!.body).toMatch(/used \$1\.92 of its \$1\.00 budget/);
    expect(table("acc_decisions").at(-1)).toMatchObject({ kind: "pause", actor_label: "Mandate budget" });
    const d = await workDetail(site, 3);
    expect(d.budget).toMatchObject({ over: true, limit: 1 });
    expect(d.mandate?.version).toBe(1);
  });

  it("puts the mandate and the Librarian's record into the Prove job", async () => {
    await saveMandate(site, owner, "Patrick", 3, mandate);
    table("acc_jobs").push(job({ id: "jp", kind: "prove", status: "queued", created_at: iso(1) }));
    const ctx = (await claim("runner-1"))!;
    expect(ctx.mandate?.version).toBe(1);
    expect(ctx.record?.path).toBe("docs/accelerator/work-3.md");
    expect(ctx.record?.body).toMatch(/## Mandate \(v1\)/);
    table("acc_sites")[0]!.docs_sync = false;
    table("acc_jobs").push(job({ id: "jp2", kind: "prove", status: "queued", work_id: "work-3", created_at: iso(0) }));
    table("acc_jobs").find((j) => j.id === "jp")!.status = "done";
    expect((await claim("runner-1"))!.record).toBeNull();
  });
});

describe("the capability inventory (G2.3a)", () => {
  it("proposes from the repository, accepts by review, links Work by its files and keeps condition to evidence", async () => {
    expect(await surveyCapabilities(site, owner, "Patrick")).toEqual(expect.objectContaining({ proposed: expect.any(Number), refreshed: 0 }));
    const inv = await readCapabilities(site);
    const browse = inv.capabilities.find((c) => c.key === "catalog.browse")!;
    expect(browse.lifecycle).toBe("proposed");
    expect(inv.scorecard.accepted).toBe(0);
    await expect(reviewCapability(site, owner, "Patrick", browse.id, "retire")).rejects.toThrow("Say why");
    const product = inv.capabilities.find((c) => c.key === "catalog.product")!;
    await reviewCapability(site, owner, "Patrick", product.id, "accept");

    // A build step that changes lib/product.ts links #3 to the product page capability.
    table("acc_jobs").push(job({ id: "jb", kind: "build_step", status: "running", generation: 1, input: { stepId: "s1" }, created_at: iso(1) }));
    await finish("jb", {
      status: "done", generation: 1,
      result: { kind: "build_step", stepId: "s1", summary: "Brand filter.", checks: { typecheck: true, tests: { passed: 5, failed: 0, total: 5 }, testsBefore: 4, touchedTests: true }, commit: "abc", files: ["app/p/[id]/page.tsx"] },
    });
    const after = await readCapabilities(site);
    const linked = after.capabilities.find((c) => c.id === product.id)!;
    expect(linked.progress[0]).toMatchObject({ number: 3 });
    expect(linked.condition.state).toBe("unverified"); // building is not verification
    expect((await workDetail(site, 3)).capabilities).toEqual([{ id: product.id, name: "Product page", area: "Catalog" }]);

    // A second survey refreshes links but never re-proposes or touches the accepted fields.
    expect((await surveyCapabilities(site, owner, "Patrick")).proposed).toBe(0);
    expect((await readCapabilities(site)).capabilities.find((c) => c.id === product.id)!.lifecycle).toBe("accepted");
  });
});

describe("the Skillsmith (§2.1)", () => {
  it("proposes from repeated failures once, and approval, rollback and decline are recorded", async () => {
    table("acc_work").push({ id: "work-4", org_id: "org-a", site_id: "site-a", number: 4, kind: "change", title: "Quotes", stage: "build" });
    for (const w of ["work-3", "work-4"]) {
      table("acc_evidence").push({ site_id: "site-a", work_id: w, kind: "step_checks", ok: false, detail: { reasons: ["No tests were added or updated, and no reason was given."] }, created_at: iso(30) });
    }
    expect(await runSkillsmith(site)).toBe(1);
    expect(await runSkillsmith(site)).toBe(0); // one open proposal per rule
    const [p] = await listProposals("site-a");
    expect(p).toMatchObject({ status: "proposed", source: "skillsmith", evaluation: "not evaluated" });
    await decideProposal(site, owner, "Patrick", p!.id, "approve");
    const skill = table("acc_skills").find((s) => s.name === p!.title)!;
    expect(skill).toMatchObject({ scope: "site", enabled: true, specialists: ["planner", "builder"] });
    await decideProposal(site, owner, "Patrick", p!.id, "rollback");
    expect(skill.enabled).toBe(false);
    await expect(decideProposal(site, owner, "Patrick", p!.id, "approve")).rejects.toThrow("already decided");
  });
});

describe("the Library (G2.5) and Boarding (G2.6)", () => {
  it("pages the timeline, filters by Work item, and exports without secrets", async () => {
    for (let i = 0; i < 3; i++) table("acc_ledger").push({ id: i + 1, site_id: "site-a", work_id: i === 2 ? null : "work-3", at: iso(10 - i), kind: "note", actor_kind: "crew", actor_label: "Builder", summary: `n${i}` });
    const t = await timeline(site);
    expect(t.entries.map((e) => e.id)).toEqual([3, 2, 1]);
    expect(t.entries[1]!.work).toEqual({ number: 3, title: "Search by brand" });
    expect((await timeline(site, { work: 3 })).entries).toHaveLength(2);
    table("acc_secrets").push({ site_id: "site-a", environment: "development", name: "STRIPE_SECRET_KEY", ciphertext: "SECRET", iv: "i", tag: "t", updated_at: iso(1) });
    const out = await exportSite(site, "Patrick");
    expect(JSON.stringify(out)).not.toContain("\"SECRET\"");
    expect(out.vault_names).toEqual([{ environment: "development", name: "STRIPE_SECRET_KEY", updated_at: expect.any(String) }]);
    expect(out.manifest.counts.ledger).toBe(3);
  });

  it("computes Boarding from the records and keeps the interview as a versioned document", async () => {
    const before = await readBoarding(site);
    expect(before.priceUsd).toBe(2500);
    expect(before.steps[0]!.id).toBe("checkup");
    expect(before.complete).toBe(false);
    await saveInterview(site, owner, "Patrick", { outcomes: "More quote requests", journeys: "Search → product → quote" });
    await saveInterview(site, owner, "Patrick", { outcomes: "More quote requests\nFewer calls", journeys: "Search → product → quote" });
    const iv = await siteInterview("site-a");
    expect(iv).toMatchObject({ version: 2, values: { outcomes: ["More quote requests", "Fewer calls"] } });
    expect(table("acc_document_versions").every((v) => typeof v.sha256 === "string" && (v.sha256 as string).length === 64)).toBe(true);
  });
});

describe("the model proxy (G2.2b)", () => {
  it("forwards a running job's Claude call with the server's key, never the token, and refuses everything else", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-server");
    table("acc_jobs").push(job({ id: "j1", kind: "build_step", status: "queued", input: { stepId: "s1" }, created_at: iso(1) }));
    const token = (await claim("runner-1"))!.toolbeltToken!;
    const seen: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, key: new Headers(init.headers).get("x-api-key") });
      return new Response("event: message_start\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const call = (path: string[], key: string, model = "claude-sonnet-5") =>
      proxyModel(new Request(`https://api.test/model/${path.join("/")}`, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model }) }), path);

    const ok = await call(["v1", "messages"], token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/event-stream");
    expect(seen).toEqual([{ url: "https://api.anthropic.com/v1/messages", key: "sk-ant-server" }]);
    expect((await call(["v1", "messages"], "forged")).status).toBe(401);
    expect((await call(["v1", "files"], token)).status).toBe(404);
    expect((await call(["v1", "messages"], token, "gpt-5")).status).toBe(400);
    table("acc_jobs")[0]!.status = "done";
    expect((await call(["v1", "messages"], token)).status).toBe(401); // a finished job's token stops working
    expect(seen).toHaveLength(1);
  });
});
