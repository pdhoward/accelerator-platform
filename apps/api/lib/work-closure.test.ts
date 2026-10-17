import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity, Site } from "@accelerator/domain";
const state = vi.hoisted(() => ({
  work: {} as Record<string, unknown>,
  jobs: [] as Record<string, unknown>[],
  writes: [] as { table: string; value: Record<string, unknown> }[],
  messages: [] as Record<string, unknown>[],
  updateError: false,
}));
vi.mock("./supabase", () => ({
  db: () => ({
    from: (table: string) => {
      const q = {
        table,
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        update: (value: Record<string, unknown>) => {
          state.writes.push({ table, value });
          return q;
        },
        insert: (value: Record<string, unknown>) => {
          state.messages.push(value);
          return q;
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            error:
              state.updateError && table === "acc_work"
                ? { message: "simulated persistence failure" }
                : null,
          }),
      };
      return q;
    },
  }),
  rows: async (q: { table: string }) =>
    q.table === "acc_work"
      ? [state.work]
      : q.table === "acc_jobs"
        ? state.jobs
        : [],
}));
import {
  cancelWork,
  closeWork,
  postMessage,
  draftDesign,
  saveDesign,
} from "./work";
const site = { id: "site-a", orgId: "org-a" } as Site;
const identity = { userId: "owner-a", email: "owner@example.test" } as Identity;
beforeEach(() => {
  state.work = {
    id: "work-3",
    org_id: "org-a",
    number: 3,
    kind: "change",
    stage: "try",
    title: "Voice",
    risk: [],
    complexity: "medium",
    branch: "work/3-voice",
    proof: { ok: true },
    created_by: "owner-a",
  };
  state.jobs = [];
  state.writes = [];
  state.messages = [];
  state.updateError = false;
});
describe("Work closure preserves delivery truth", () => {
  it("rejects conversation and design mutations on terminal records", async () => {
    for (const stage of ["done", "cancelled"]) {
      state.work.stage = stage;
      await expect(
        postMessage(site, identity, { name: "Owner", role: "owner", member: true }, 3, "new scope"),
      ).rejects.toThrow("Start another improvement");
      await expect(draftDesign(site, identity, 3)).rejects.toThrow(
        "Start another improvement",
      );
      await expect(
        saveDesign(site, identity, "Owner", 3, "new design"),
      ).rejects.toThrow("Start another improvement");
    }
    expect(state.messages).toEqual([]);
    expect(state.writes).toEqual([]);
  });
  it("does not revise a released design under old approvals", async () => {
    state.work.released_at = "2026-10-16T12:00:00Z";
    await expect(draftDesign(site, identity, 3)).rejects.toThrow(
      "recorded release",
    );
    await expect(
      saveDesign(site, identity, "Owner", 3, "new design"),
    ).rejects.toThrow("recorded release");
  });

  it("closes without clearing branches/proof or claiming no code was built", async () => {
    await cancelWork(site, identity, "Owner", 3, true);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]?.value).toEqual({
      stage: "cancelled",
      updated_at: expect.any(String),
    });
    expect(state.messages[0]?.body).toContain(
      "without a recorded platform release",
    );
    expect(state.messages[0]?.body).not.toContain("without building");
  });
  it("rejects closure while a job runs", async () => {
    state.jobs = [{ id: "job-a", kind: "build_step", status: "running" }];
    await expect(cancelWork(site, identity, "Owner", 3, true)).rejects.toThrow(
      "Wait for the engine",
    );
    expect(state.writes).toEqual([]);
  });
  it("preserves partner restriction on another person's item", async () => {
    await expect(
      cancelWork(
        site,
        { ...identity, userId: "partner-a" },
        "Partner",
        3,
        false,
      ),
    ).rejects.toThrow("account's own people");
    expect(state.writes).toEqual([]);
  });
  it("uses completion rather than cancellation after a recorded release", async () => {
    state.work.released_at = "2026-10-16T12:00:00Z";
    await expect(cancelWork(site, identity, "Owner", 3, true)).rejects.toThrow(
      "already live",
    );
    await closeWork(site, identity, "Owner", 3);
    expect(state.writes[0]?.value.stage).toBe("done");
  });
  it("does not claim success or write a closure message when persistence fails", async () => {
    state.updateError = true;
    await expect(cancelWork(site, identity, "Owner", 3, true)).rejects.toThrow(
      "simulated persistence failure",
    );
    expect(state.messages).toEqual([]);
  });
});
