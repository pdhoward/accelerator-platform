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
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
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

import { finish, postMessage, setComplexity, shipWork, type Speaker } from "./work";

const site = { id: "site-a", orgId: "org-a", name: "Machine Shop" } as Site;
const owner = { userId: "owner-a", email: "owner@example.test" } as Identity;
const t = (name: string) => (db.tables[name] ??= []);
const work = () => t("acc_work")[0]!;
const jobs = () => t("acc_jobs");
const lastJob = () => jobs().at(-1)!;
const said = () => t("acc_work_messages").map((m) => String(m.body));
const ownerSpeaks: Speaker = { name: "Owner", role: "owner", member: true };

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

  it("repairs a step the Protocol blocked, twice at most, then stops without ever shipping unproven code", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    const step = t("acc_work_steps")[0]!.id as string;
    const failing = { ...green(step), checks: { typecheck: true, tests: { passed: 11, failed: 1, total: 12 }, testsBefore: 11, touchedTests: true } };
    for (const repair of [1, 2]) {
      await complete(failing);
      expect(t("acc_work_steps")[0]).toMatchObject({ status: "blocked", attempts: repair });
      expect(lastJob()).toMatchObject({ kind: "build_step", status: "queued", input: { stepId: step, repairReasons: ["1 test failing."] } });
      expect(said().at(-1)).toContain(`repair ${repair} of 2`);
    }
    await complete(failing);
    expect(t("acc_work_steps")[0]).toMatchObject({ status: "blocked", attempts: 3 });
    expect(jobs().filter((j) => j.status === "queued")).toHaveLength(0);
    expect(jobs().some((j) => j.kind === "prove" || j.kind === "release")).toBe(false);
    expect(t("acc_evidence").filter((e) => e.kind === "step_checks" && e.ok === false)).toHaveLength(3);
  });

  it("fixes what a failed Prove found with one extra step, then proves again", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    await complete(green(t("acc_work_steps")[0]!.id as string));
    await complete({ ...proven, facts: { ...proven.facts, build: false } });
    expect(work().proof_repairs).toBe(1);
    const fix = t("acc_work_steps").at(-1)!;
    expect(fix).toMatchObject({ title: "Fix what Prove found", status: "todo" });
    expect(String(fix.detail)).toContain("The production build failed.");
    expect(lastJob()).toMatchObject({ kind: "build_step", input: { stepId: fix.id } });
    await complete(green(fix.id as string));
    expect(lastJob()).toMatchObject({ kind: "prove", status: "queued" });
  });

  it("records the policy's ship decision and the evidence behind it", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    await complete(green(t("acc_work_steps")[0]!.id as string));
    await complete(proven);
    const ship = t("acc_decisions").find((d) => d.kind === "ship")!;
    expect(ship).toMatchObject({ actor_kind: "policy", actor_label: "Low-complexity policy", target: "abc123", via: "policy", actor_user_id: null });
    expect(t("acc_evidence").map((e) => [e.kind, e.ok])).toEqual([["step_checks", true], ["prove", true]]);
    expect(t("acc_ledger").filter((l) => l.counts).map((l) => l.kind)).toEqual(["step_checks", "prove", "decision"]);
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

describe("decisions in the conversation", () => {
  const atShipIt = () => {
    Object.assign(work(), { complexity: "medium", ready_at: "x", plan_approved_at: "x", stage: "try", proof: { ok: true, commit: "abc123", reasons: [] }, preview_url: "https://p" });
    t("acc_work_docs").push({ id: "doc-1", work_id: "work-3", version: 1, body: "# Brief", approved_at: "x" });
    t("acc_work_steps").push({ id: "step-1", work_id: "work-3", position: 1, title: "Fix", detail: "", status: "done" });
    jobs()[0]!.status = "done";
  };
  it("ships on a typed 'ship it' bound to the candidate the person saw", async () => {
    atShipIt();
    await postMessage(site, owner, ownerSpeaks, 3, "Ship it!", "ship:abc123");
    expect(work().try_approved_by).toBe("owner-a");
    expect(lastJob()).toMatchObject({ kind: "release", status: "queued" });
    expect(t("acc_decisions").at(-1)).toMatchObject({ kind: "ship", via: "typed", actor_user_id: "owner-a", target: "abc123" });
  });
  it("refuses a typed approval for a decision that changed since it was shown", async () => {
    atShipIt();
    await postMessage(site, owner, ownerSpeaks, 3, "ship it", "ship:old999");
    expect(work().try_approved_at).toBeUndefined();
    expect(said().at(-1)).toContain('Not applied: what\'s waiting now is "Ship it (abc123)"');
    expect(jobs().filter((j) => j.status === "queued")).toHaveLength(0);
  });
  it("never accepts a typed approval for money, data, auth or security, nor from partner staff", async () => {
    atShipIt();
    work().risk = ["money"];
    work().complexity = "high";
    await postMessage(site, owner, ownerSpeaks, 3, "approve", "approve_try:abc123");
    expect(said().at(-1)).toContain("needs the Approve for release button");
    work().risk = [];
    work().complexity = "medium";
    await postMessage(site, owner, { name: "Partner", role: "operator", member: false }, 3, "ship it", "ship:abc123");
    expect(said().at(-1)).toContain("partner staff can discuss and draft");
    expect(work().try_approved_at).toBeUndefined();
  });
  it("treats a bare 'yes' as conversation for the lead, not an approval", async () => {
    atShipIt();
    await postMessage(site, owner, ownerSpeaks, 3, "yes", "ship:abc123");
    expect(work().try_approved_at).toBeUndefined();
    expect(lastJob()).toMatchObject({ kind: "discuss", status: "queued" });
  });
  it("pauses on 'stop', withdrawing queued work, and resumes where it was", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    expect(lastJob()).toMatchObject({ kind: "build_step", status: "queued" });
    await postMessage(site, owner, ownerSpeaks, 3, "stop");
    expect(work().paused_at).toBeTruthy();
    expect(lastJob()).toMatchObject({ kind: "build_step", status: "cancelled" });
    expect(t("acc_decisions").at(-1)).toMatchObject({ kind: "pause" });
    await postMessage(site, owner, ownerSpeaks, 3, "resume");
    expect(work().paused_at).toBeNull();
    expect(lastJob()).toMatchObject({ kind: "build_step", status: "queued" });
  });
});

describe("the conversation never waits behind the build", () => {
  it("keeps a message sent while the crew works and has the lead answer it before the crew goes on", async () => {
    await complete({ kind: "discuss", reply: "On it.", assessment: { complexity: "low", ready: true, reason: "Small." } });
    await postMessage(site, owner, { name: "Owner", role: "owner", member: true }, 3, "Also make it open in the same tab.");
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
