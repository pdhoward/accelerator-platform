import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Site } from "@accelerator/domain";

/** The Cockpit Dial's API: gathering records for the domain projection (gen2-crew.md §19.5). */
const mode = vi.hoisted(() => ({ demo: false }));
vi.mock("./supabase", async () => (await import("./testing/fake-db")).fakeSupabase);
vi.mock("./auth", () => ({ demoMode: () => mode.demo }));

import { readInstruments } from "./instruments";
import { resetFakeDb } from "./testing/fake-db";

const site = { id: "site-a", orgId: "org-a", name: "Machine Shop", demo: false } as Site;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const workRow = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `work-${n}`, org_id: "org-a", site_id: "site-a", number: n, kind: "change", title: `Item ${n}`, stage: "build", risk: [],
  complexity: "medium", created_at: hoursAgo(48), updated_at: hoursAgo(30), ...extra,
});

beforeEach(() => {
  mode.demo = false;
  resetFakeDb({
    acc_sites: [{ id: "site-a", baseline_tests: 10 }],
    acc_work: [
      workRow(1, { stage: "try", proof: { ok: true, commit: "abc12345", reasons: [] }, plan_approved_at: hoursAgo(40), ready_at: hoursAgo(45) }),
      workRow(2, { complexity: "low" }),
      { ...workRow(3), site_id: "site-b" }, // another tenant's item never appears
    ],
    acc_work_docs: [{ id: "d1", work_id: "work-1", version: 1, body: "# Brief", approved_at: hoursAgo(41), created_at: hoursAgo(42) }],
    acc_work_steps: [{ id: "s1", work_id: "work-1", position: 1, title: "Fix", detail: "", status: "done", attempts: 1 }],
    acc_evidence: [
      { site_id: "site-a", work_id: "work-1", step_id: "s1", kind: "step_checks", ok: true, commit_sha: "abc12345", passed: 12, failed: 0, total: 12, created_at: hoursAgo(6), detail: {} },
      { site_id: "site-a", work_id: "work-1", step_id: null, kind: "prove", ok: true, commit_sha: "abc12345", passed: 12, failed: 0, total: 12, created_at: hoursAgo(5), detail: {} },
      { site_id: "site-b", work_id: "work-3", step_id: null, kind: "prove", ok: false, commit_sha: "zzz", passed: 1, failed: 9, total: 10, created_at: hoursAgo(1), detail: {} },
    ],
    acc_ledger: [
      { site_id: "site-a", work_id: "work-1", at: hoursAgo(6), kind: "step_checks", actor_kind: "crew", actor_label: "Builder", counts: true, summary: "Step built and checked." },
      { site_id: "site-a", work_id: "work-1", at: hoursAgo(41), kind: "decision", actor_kind: "person", actor_label: "Patrick", counts: true, summary: "Approved the Brief v1." },
    ],
  });
});

describe("readInstruments", () => {
  it("reads only this site's records, through the domain rules", async () => {
    const r = await readInstruments(site);
    expect(r).toMatchObject({ source: "recorded", siteName: "Machine Shop", scope: { kind: "site" } });
    const tests = r.site.find((x) => x.id === "tests")!;
    // The other site's failing Prove (1 hour ago, newer) must not leak in.
    expect(tests).toMatchObject({ condition: "verified", headline: "12", unit: "of 12 passing" });
    expect(tests.facts[1]).toBe("Suite 12 against a baseline of 10");
    expect(r.crew.find((x) => x.id === "builder")).toMatchObject({ headline: "1", state: "Active" });
    expect(r.crew.find((x) => x.id === "people")).toMatchObject({ state: "Active" });
  });

  it("counts the decision waiting on a person with the same rules as the conversation", async () => {
    const flight = (await readInstruments(site)).site.find((x) => x.id === "flight")!;
    // #1 is Medium, proven and untried: "Ship it" waits on the person, for 30 hours.
    expect(flight).toMatchObject({ condition: "attention", headline: "1", evidence: { href: "workItem", number: 1 } });
    expect(flight.facts[1]).toMatch(/^Oldest: #1 Ship it \(abc12345\), waiting 30 h$/);
  });

  it("scopes to one Work item and refuses one that isn't this site's", async () => {
    const r = await readInstruments(site, 1);
    expect(r.scope).toEqual({ kind: "work", number: 1 });
    expect(r.site.map((x) => x.id)).toEqual(["integrity", "tests", "flight", "changes"]);
    expect(r.site[0]).toMatchObject({ condition: "verified", headline: "2/2" });
    await expect(readInstruments(site, 3)).rejects.toThrow("doesn't exist");
    await expect(readInstruments(site, 0)).rejects.toThrow("Invalid work number");
  });

  it("serves labelled synthetic readings only for the keyless demo site", async () => {
    mode.demo = true;
    const r = await readInstruments({ ...site, demo: true });
    expect(r.source).toBe("sample");
    expect(r.crew.find((x) => x.id === "builder")?.facts.join(" ")).toContain("self-repair");
    await expect(readInstruments(site)).rejects.toThrow("require the database");
  });
});
