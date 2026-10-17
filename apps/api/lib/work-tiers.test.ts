import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity, Site } from "@accelerator/domain";

/**
 * The crew's own progress by complexity tier (gen2-crew.md §17), through
 * finish() and drive() against a small in-memory table fake.
 */
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, seq: 0 }));

vi.mock("./supabase", () => {
  type Filter = (r: Row) => boolean;
  const query = (table: string) => {
    const filters: Filter[] = [];
    let op: { kind: "select" } | { kind: "update"; value: Row } | { kind: "insert"; value: Row | Row[] } | { kind: "delete" } = { kind: "select" };
    let max = Infinity;
    let sort: { col: string; asc: boolean } | null = null;
    const all = () => (db.tables[table] ??= []);
    const matching = () => all().filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op.kind === "insert") {
        // Column defaults the real tables fill in.
        const defaults: Row = table === "acc_jobs" ? { status: "queued" } : table === "acc_work_steps" ? { status: "todo" } : {};
        const added = (Array.isArray(op.value) ? op.value : [op.value]).map((v) => ({ id: `${table}-${++db.seq}`, created_at: new Date(Date.now() + db.seq).toISOString(), ...defaults, ...v }));
        all().push(...added);
        return added;
      }
      if (op.kind === "update") {
        const hit = matching();
        for (const r of hit) Object.assign(r, op.value);
        return hit;
      }
      if (op.kind === "delete") {
        const keep = all().filter((r) => !filters.every((f) => f(r)));
        db.tables[table] = keep;
        return [];
      }
      let out = matching();
      if (sort) {
        const { col, asc } = sort;
        out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
      }
      return out.slice(0, max);
    };
    const q = {
      table,
      run,
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      gte: () => q,
      order: (col: string, o?: { ascending?: boolean }) => ((sort = { col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((max = n), q),
      single: () => q,
      update: (value: Row) => ((op = { kind: "update", value }), q),
      insert: (value: Row | Row[]) => ((op = { kind: "insert", value }), q),
      delete: () => ((op = { kind: "delete" }), q),
      upsert: () => q,
      then: (resolve: (v: unknown) => unknown) => {
        const data = run();
        return resolve({ data: op.kind === "insert" && !Array.isArray((op as { value: unknown }).value) ? data[0] : data, error: null, count: data.length });
      },
    };
    return q;
  };
  return { db: () => ({ from: query }), rows: async (q: { run: () => Row[] }) => q.run() };
});

import { finish, postMessage, setComplexity, shipWork } from "./work";

const site = { id: "site-a", orgId: "org-a", name: "Machine Shop" } as Site;
const owner = { userId: "owner-a", email: "owner@example.test" } as Identity;
const t = (name: string) => (db.tables[name] ??= []);
const work = () => t("acc_work")[0]!;
const jobs = () => t("acc_jobs");
const lastJob = () => jobs().at(-1)!;
const said = () => t("acc_work_messages").map((m) => String(m.body));

/** Finish the job the crew queued last, as the runner would. */
async function complete(result: Row) {
  const j = lastJob();
  j.status = "running";
  await finish(j.id as string, { status: "done", result: result as never });
}

const green = (stepId: string, files = ["components/footer.tsx", "components/footer.test.tsx"]) => ({
  kind: "build_step", stepId, summary: "Fixed the footer link.", commit: "abc123", files,
  checks: { typecheck: true, tests: { passed: 12, failed: 0, total: 12 }, testsBefore: 11, touchedTests: true },
});
const proven = { kind: "prove", facts: { typecheck: true, build: true, tests: { passed: 12, failed: 0, total: 12 }, pushed: true, previewState: "success" }, branch: "work/3-x", commit: "abc123", previewUrl: "https://preview.example.test", previewStatus: 200 };

beforeEach(() => {
  db.tables = {
    acc_work: [{ id: "work-3", org_id: "org-a", site_id: "site-a", number: 3, kind: "change", title: "Fix the Returns link", stage: "discuss", risk: [], complexity: "medium", complexity_set_by: "platform", created_by: "owner-a" }],
    acc_work_messages: [{ id: "m1", work_id: "work-3", author_kind: "person", author_label: "Owner", body: "The Returns link in the footer is broken.", created_at: "2026-10-17T10:00:00Z" }],
    acc_jobs: [{ id: "job-1", org_id: "org-a", site_id: "site-a", work_id: "work-3", kind: "discuss", role: "consult", provider: "anthropic", model: "claude-opus-5-5", status: "queued", created_by: "owner-a", created_at: "2026-10-17T10:00:01Z" }],
  };
  db.seq = 100;
});

describe("Low complexity: no decisions, through the TDD plane", () => {
  it("rates, builds, proves and ships with no one pressing anything", async () => {
    await complete({ kind: "discuss", reply: "Found it: a wrong path in the footer. Low: I'll fix it and ship it.", assessment: { complexity: "low", ready: true, reason: "One file, clearly specified." } });
    expect(work()).toMatchObject({ complexity: "low", recommended_complexity: "low", complexity_reason: "One file, clearly specified." });
    expect(work().plan_approved_at).toBeTruthy();
    expect(t("acc_work_steps")).toHaveLength(1);
    expect(lastJob()).toMatchObject({ kind: "build_step", status: "queued" });

    await complete(green(t("acc_work_steps")[0]!.id as string));
    expect(lastJob()).toMatchObject({ kind: "prove", status: "queued" });

    await complete(proven);
    expect(work().try_approved_at).toBeTruthy();
    expect(work().try_approved_by).toBeNull(); // the policy, not a person
    expect(lastJob()).toMatchObject({ kind: "release", status: "queued" });
    expect(said().some((b) => b.includes("every check in the TDD plane passed"))).toBe(true);
  });

  it("stops when the Protocol blocks a step, and never ships unproven code", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    const step = t("acc_work_steps")[0]!.id as string;
    await complete({ ...green(step), checks: { typecheck: true, tests: { passed: 11, failed: 1, total: 12 }, testsBefore: 11, touchedTests: true } });
    expect(t("acc_work_steps")[0]!.status).toBe("blocked");
    expect(jobs().filter((j) => j.status === "queued")).toHaveLength(0);
    expect(jobs().some((j) => j.kind === "prove" || j.kind === "release")).toBe(false);
  });

  it("raises the item to High when the build reaches a protected area, and drafts a design instead of going on", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    await complete(green(t("acc_work_steps")[0]!.id as string, ["components/footer.tsx", "supabase/migrations/0009_links.sql"]));
    expect(work()).toMatchObject({ complexity: "high", plan_approved_at: null, auto_ship: false });
    expect(said().some((b) => b.startsWith("Raised to High complexity."))).toBe(true);
    expect(lastJob()).toMatchObject({ kind: "design", status: "queued" });
    expect(jobs().some((j) => j.kind === "prove")).toBe(false);
  });
});

describe("Medium complexity: the Brief and Ship it", () => {
  it("waits for Ship it on the proven preview, then releases", async () => {
    Object.assign(work(), { complexity: "medium", ready_at: "2026-10-17T10:01:00Z", plan_approved_at: "2026-10-17T10:05:00Z" });
    t("acc_work_docs").push({ id: "doc-1", work_id: "work-3", version: 1, body: "# Brief", approved_at: "2026-10-17T10:04:00Z" });
    t("acc_work_steps").push({ id: "step-1", work_id: "work-3", position: 1, title: "Fix the link", detail: "", status: "done" });
    jobs()[0]!.status = "done"; // the lead already answered
    jobs().push({ id: "job-p", org_id: "org-a", site_id: "site-a", work_id: "work-3", kind: "prove", role: "build", provider: "anthropic", model: "m", status: "queued", created_by: "owner-a", created_at: "2026-10-17T10:06:00Z" });
    await complete(proven);
    expect(work().try_approved_at).toBeFalsy();
    expect(jobs().filter((j) => j.status === "queued")).toHaveLength(0);

    await shipWork(site, owner, "Owner", "owner", 3);
    expect(work().try_approved_by).toBe("owner-a");
    expect(lastJob()).toMatchObject({ kind: "release", status: "queued" });
  });

  it("ships on its own when the standing approval is on", async () => {
    Object.assign(work(), { complexity: "medium", auto_ship: true, ready_at: "x", plan_approved_at: "x" });
    t("acc_work_docs").push({ id: "doc-1", work_id: "work-3", version: 1, body: "# Brief", approved_at: "x" });
    t("acc_work_steps").push({ id: "step-1", work_id: "work-3", position: 1, title: "Fix", detail: "", status: "done" });
    jobs()[0]!.status = "done"; // the lead already answered
    jobs().push({ id: "job-p", org_id: "org-a", site_id: "site-a", work_id: "work-3", kind: "prove", role: "build", provider: "anthropic", model: "m", status: "queued", created_by: "owner-a", created_at: "2026-10-17T10:06:00Z" });
    await complete(proven);
    expect(lastJob()).toMatchObject({ kind: "release", status: "queued" });
    expect(said().some((b) => b.startsWith("Standing approval"))).toBe(true);
  });
});

describe("the conversation never waits behind the build", () => {
  it("keeps a message sent while the crew works and has the lead answer it before the crew goes on", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    await postMessage(site, owner, "Owner", 3, "Also make it open in the same tab.");
    expect(jobs().filter((j) => j.status === "queued")).toHaveLength(1); // only the build
    await complete(green(t("acc_work_steps")[0]!.id as string));
    expect(lastJob()).toMatchObject({ kind: "discuss", status: "queued" });
  });
});

describe("a person's tier choice", () => {
  it("can't go below the protected-risk floor", async () => {
    Object.assign(work(), { risk: ["money"], complexity: "high" });
    jobs()[0]!.status = "done";
    await expect(setComplexity(site, owner, "Owner", 3, "low")).rejects.toThrow("stays High");
    expect(work().complexity).toBe("high");
  });
  it("sticks: a later assessment updates the recommendation, not the tier", async () => {
    jobs()[0]!.status = "done";
    t("acc_work_messages").push({ id: "m2", work_id: "work-3", author_kind: "model", author_label: "Lead", body: "Noted.", created_at: "2026-10-17T10:00:02Z" });
    await setComplexity(site, owner, "Owner", 3, "high");
    jobs().push({ id: "job-2", work_id: "work-3", site_id: "site-a", org_id: "org-a", kind: "discuss", provider: "anthropic", model: "m", status: "queued", created_by: "owner-a" });
    await complete({ kind: "discuss", reply: "Easy one.", assessment: { complexity: "low", ready: false, reason: "Tiny." } });
    expect(work()).toMatchObject({ complexity: "high", complexity_set_by: "person", recommended_complexity: "low" });
  });
});
