import { describe, expect, it } from "vitest";

import { archivesToDelete, claimLapsed, DEFAULT_RETENTION, draftsToPrune, lapsedFate, logsToArchive, MAX_JOB_ATTEMPTS } from "./execution";
import { readSse, sse, trailerFilter } from "./lead-stream";
import { readSlash } from "./slash";
import { mayCall, TOOLBELT, toolsFor } from "./toolbelt";

describe("streaming the lead's reply hides the assessment lines", () => {
  const run = (chunks: string[]) => {
    const f = trailerFilter();
    return chunks.map((c) => f.push(c)).join("") + f.flush();
  };
  it("passes words through as they arrive", () => {
    const f = trailerFilter();
    expect(f.push("Found it")).toBe("Found it");
    expect(f.push(": a wrong ")).toBe(": a wrong ");
    expect(f.push("path.\n")).toBe("path.\n");
  });
  it("never shows COMPLEXITY, READY or REASON, however the chunks split", () => {
    const text = "Low: I'll fix it.\n\nCOMPLEXITY: low\nREADY: yes\nREASON: One file.";
    expect(run([text])).toBe("Low: I'll fix it.\n\n");
    expect(run(text.split(""))).toBe("Low: I'll fix it.\n\n");
    expect(run(["Low: ok.\nCOMP", "LEXITY: medium\nRE", "ADY: no\nREA", "SON: unclear"])).toBe("Low: ok.\n");
  });
  it("shows ordinary lines that merely start like a hidden one", () => {
    expect(run(["Ready to ", "go once you approve.\nReasonable, yes."])).toBe("Ready to go once you approve.\nReasonable, yes.");
  });
  it("frames and reads server-sent events, keeping a partial event for later", () => {
    const wire = sse({ type: "delta", text: "Hel" }) + sse({ type: "delta", text: "lo" }) + 'data: {"type":"do';
    const { events, rest } = readSse(wire);
    expect(events).toEqual([{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }]);
    expect(readSse(`${rest}ne"}\n\n`).events).toEqual([{ type: "done" }]);
  });
});

describe("slash commands are shortcuts, never new authority", () => {
  it("turns /ship and /approve into the typed decision", () => {
    expect(readSlash("/ship")).toEqual({ kind: "say", body: "ship it" });
    expect(readSlash(" /approve ")).toEqual({ kind: "say", body: "approve" });
  });
  it("reads pause, resume, tier, panels, talk and help", () => {
    expect(readSlash("/pause")).toEqual({ kind: "pause" });
    expect(readSlash("/resume")).toEqual({ kind: "resume" });
    expect(readSlash("/tier High")).toEqual({ kind: "tier", complexity: "high" });
    expect(readSlash("/brief")).toEqual({ kind: "open", panel: "design" });
    expect(readSlash("/log")).toEqual({ kind: "open", panel: "log" });
    expect(readSlash("/talk")).toEqual({ kind: "talk" });
    expect(readSlash("/help")).toEqual({ kind: "help" });
  });
  it("leaves ordinary messages alone and names unknown commands", () => {
    expect(readSlash("ship it")).toBeNull();
    expect(readSlash("/tier extreme")).toEqual({ kind: "unknown", text: "/tier extreme" });
    expect(readSlash("/deploy now")).toEqual({ kind: "unknown", text: "/deploy now" });
  });
});

describe("the Toolbelt: a specialist is its tool list", () => {
  it("lets every role read, and only working roles post notes", () => {
    expect(toolsFor("consult").map((t) => t.name)).toEqual(["work_status", "work_history", "work_decisions", "evidence_recent", "site_census"]);
    expect(toolsFor("build").map((t) => t.name)).toContain("rail_note");
    expect(mayCall("consult", "rail_note")).toBe(false);
    expect(mayCall("build", "rail_note")).toBe(true);
  });
  it("has no tool that releases, merges, writes data or takes a tenant from input", () => {
    expect(TOOLBELT.some((t) => /release|merge|deploy|promote|write|delete/.test(t.name))).toBe(false);
    for (const t of TOOLBELT) {
      expect(JSON.stringify(t.inputSchema)).not.toMatch(/site_?id|work_?id|org_?id|tenant/i);
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
    expect(mayCall("build", "release_promote")).toBe(false);
  });
});

describe("reliable execution: lapsed claims", () => {
  it("requeues an ordinary job once, then gives up", () => {
    expect(lapsedFate({ kind: "build_step", attempts: 1 }).fate).toBe("requeue");
    expect(lapsedFate({ kind: "prove", attempts: MAX_JOB_ATTEMPTS }).fate).toBe("fail");
  });
  it("never retries a release blindly: its outcome is unknown", () => {
    const r = lapsedFate({ kind: "release", attempts: 1 });
    expect(r.fate).toBe("unknown");
    expect(r.note).toContain("Check main and the live site before releasing again");
  });
  it("lapses on the recorded expiry, or 30 minutes after an old claim started", () => {
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(claimLapsed({ claimExpiresAt: "2026-10-19T11:59:00Z", startedAt: null }, now)).toBe(true);
    expect(claimLapsed({ claimExpiresAt: "2026-10-19T12:05:00Z", startedAt: "2026-10-19T08:00:00Z" }, now)).toBe(false);
    expect(claimLapsed({ claimExpiresAt: null, startedAt: "2026-10-19T11:00:00Z" }, now)).toBe(true);
    expect(claimLapsed({ claimExpiresAt: null, startedAt: "2026-10-19T11:45:00Z" }, now)).toBe(false);
  });
});

describe("retention keeps the proof and prunes only old drafts", () => {
  const v = (id: string, version: number, approved = false, documentId = "doc") => ({ id, documentId, version, approved, pruned: false });
  it("keeps the current, approved and referenced versions and the newest drafts", () => {
    const versions = [v("v1", 1, true), v("v2", 2), v("v3", 3), v("v4", 4), v("v5", 5), v("v6", 6)];
    // Current: v6. Approved: v1. Referenced: v2. Drafts kept: 2 → v5, v4 stay; v3 goes.
    expect(draftsToPrune(versions, new Set(["v2"]), 2).map((x) => x.id)).toEqual(["v3"]);
    expect(draftsToPrune(versions, new Set(), 10)).toEqual([]);
  });
  it("moves only finished, unarchived logs older than the hot window, and deletes only expired archives", () => {
    const now = Date.parse("2026-10-19T00:00:00Z");
    const day = 86_400_000;
    const jobs = [
      { id: "old", finishedAt: new Date(now - 40 * day).toISOString(), archived: false },
      { id: "fresh", finishedAt: new Date(now - 5 * day).toISOString(), archived: false },
      { id: "running", finishedAt: null, archived: false },
      { id: "done-before", finishedAt: new Date(now - 90 * day).toISOString(), archived: true },
    ];
    expect(logsToArchive(jobs, DEFAULT_RETENTION, now).map((j) => j.id)).toEqual(["old"]);
    const archives = [{ id: "a", archivedAt: new Date(now - 400 * day).toISOString(), deleted: false }, { id: "b", archivedAt: new Date(now - 10 * day).toISOString(), deleted: false }];
    expect(archivesToDelete(archives, DEFAULT_RETENTION, now).map((a) => a.id)).toEqual(["a"]);
  });
});
