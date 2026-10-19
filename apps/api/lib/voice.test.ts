import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity, Site } from "@accelerator/domain";

/** Live voice on a Work item (gen2-crew.md §19.1): the pass, the lead's tools and the transcript. */
vi.mock("./supabase", async () => (await import("./testing/fake-db")).fakeSupabase);
vi.mock("./auth", () => ({ demoMode: () => false }));

import { resetFakeDb, table } from "./testing/fake-db";
import { runVoiceTool, saveVoiceTranscript, startVoiceCall, VoiceUnavailable } from "./voice";
import type { Speaker } from "./work";

const site = { id: "site-a", orgId: "org-a", name: "Machine Shop" } as Site;
const owner = { userId: "owner-a", email: "owner@example.test" } as Identity;
const ownerSpeaks: Speaker = { name: "Patrick", role: "owner", member: true };
const work = () => table("acc_work")[0]!;
const lastJob = () => table("acc_jobs").at(-1);
const said = () => table("acc_work_messages").map((m) => String(m.body));

beforeEach(() => {
  resetFakeDb({
    acc_work: [{
      id: "work-3", org_id: "org-a", site_id: "site-a", number: 3, kind: "change", title: "Faster quote form", stage: "try", risk: [],
      complexity: "medium", ready_at: "x", plan_approved_at: "x", proof: { ok: true, commit: "abc123", reasons: [] }, preview_url: "https://p",
      created_at: "2026-10-19T09:00:00Z", updated_at: "2026-10-19T10:00:00Z",
    }],
    acc_work_docs: [{ id: "doc-1", work_id: "work-3", version: 1, body: "# Brief\n\n## Summary\nFaster on phones.", approved_at: "x", created_at: "2026-10-19T09:30:00Z" }],
    acc_work_steps: [{ id: "step-1", work_id: "work-3", position: 1, title: "Simplify the form", detail: "", status: "done", attempts: 1 }],
    acc_work_messages: [{ id: "m1", work_id: "work-3", author_kind: "person", author_label: "Patrick", body: "Make the quote form faster on phones.", created_at: "2026-10-19T09:00:00Z" }],
    acc_jobs: [{ id: "job-1", work_id: "work-3", site_id: "site-a", org_id: "org-a", kind: "discuss", status: "done", created_at: "2026-10-19T09:00:01Z" }],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("starting a call", () => {
  it("says plainly which setting is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(startVoiceCall(site, ownerSpeaks, 3)).rejects.toThrow(new VoiceUnavailable("Live voice isn't set up on this server yet: OPENAI_API_KEY is missing."));
  });

  it("mints a one-call pass grounded in the item, and never hands out the key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-only");
    const fetchMock = vi.fn(async () => Response.json({ value: "ek_one_call", expires_at: 1_900_000_000 }));
    vi.stubGlobal("fetch", fetchMock);
    const call = await startVoiceCall(site, ownerSpeaks, 3);
    expect(call).toMatchObject({ pass: "ek_one_call", minutes: 15 });
    expect(JSON.stringify(call)).not.toContain("sk-server-only");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-server-only");
    const session = JSON.parse(String(init.body)).session;
    expect(session.model).toBe("gpt-realtime");
    expect(session.instructions).toContain('Work item #3: "Faster quote form"');
    expect(session.instructions).toContain("Waiting on the person: Ship it (abc123).");
    expect(Date.parse(call.endsAt) - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  it("reports OpenAI refusing the pass as a snag, not a crash", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(startVoiceCall(site, ownerSpeaks, 3)).rejects.toBeInstanceOf(VoiceUnavailable);
  });
});

describe("the lead's tools run with the caller's own authority", () => {
  it("get_status reads the item and the decision waiting, with its key", async () => {
    const s = JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "get_status", "{}"));
    expect(s.item).toBe("#3 Faster quote form");
    expect(s.waiting_on_person).toEqual({ title: "Ship it (abc123)", decision_key: "ship:abc123", button_only: false });
    expect(s.milestones.find((m: { step: string }) => m.step === "Ship it")).toMatchObject({ state: "waiting" });
  });

  it("send_to_crew posts the person's words, marked as by voice, and the lead picks it up", async () => {
    const out = JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "send_to_crew", JSON.stringify({ message: "Also keep the phone field optional." })));
    expect(out.ok).toBe(true);
    expect(table("acc_work_messages").at(-1)).toMatchObject({ author_kind: "person", author_label: "Patrick (by voice)", body: "Also keep the phone field optional." });
    expect(lastJob()).toMatchObject({ kind: "discuss", status: "queued" });
  });

  it("answer_decision ships the decision the person confirmed, bound to its key", async () => {
    const out = JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "answer_decision", JSON.stringify({ decision_key: "ship:abc123" })));
    expect(out.applied).toBe(true);
    expect(lastJob()).toMatchObject({ kind: "release", status: "queued" });
    expect(table("acc_decisions").at(-1)).toMatchObject({ kind: "ship", actor_user_id: "owner-a", target: "abc123" });
  });

  it("answer_decision refuses a stale key, an Owner-gated decision and partner staff", async () => {
    const stale = JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "answer_decision", JSON.stringify({ decision_key: "ship:old" })));
    expect(stale).toMatchObject({ applied: false });
    expect(stale.reason).toBe(`That decision has changed; what's waiting now is "Ship it (abc123)". Check with the person.`);
    expect(work().try_approved_at).toBeUndefined();

    Object.assign(work(), { risk: ["money"], complexity: "high" });
    const gated = JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "answer_decision", JSON.stringify({ decision_key: "approve_try:abc123" })));
    expect(gated).toMatchObject({ applied: false });
    expect(gated.reason).toContain("needs the Approve for release button");

    Object.assign(work(), { risk: [], complexity: "medium" });
    const partner = JSON.parse(await runVoiceTool(site, owner, { name: "Partner", role: "operator", member: false }, 3, "answer_decision", JSON.stringify({ decision_key: "ship:abc123" })));
    expect(partner).toMatchObject({ applied: false });
    expect(work().try_approved_at).toBeUndefined();
  });

  it("can't slip an approval through send_to_crew", async () => {
    await runVoiceTool(site, owner, ownerSpeaks, 3, "send_to_crew", JSON.stringify({ message: "approve" }));
    expect(work().try_approved_at).toBeUndefined();
    expect(said().at(-1)).toContain("Not applied");
  });

  it("pause_crew and resume_crew stop and restart the crew", async () => {
    await runVoiceTool(site, owner, ownerSpeaks, 3, "pause_crew", "{}");
    expect(work().paused_at).toBeTruthy();
    await runVoiceTool(site, owner, ownerSpeaks, 3, "resume_crew", "{}");
    expect(work().paused_at).toBeNull();
  });

  it("answers an unknown tool or bad arguments with an error the lead can say, not a crash", async () => {
    expect(JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "release", "{}"))).toEqual({ error: "There's no tool called release." });
    expect(JSON.parse(await runVoiceTool(site, owner, ownerSpeaks, 3, "send_to_crew", "not json"))).toEqual({ error: "Say what to pass to the crew." });
  });
});

describe("the transcript", () => {
  it("lands in the conversation as one message, and on the timeline", async () => {
    await saveVoiceTranscript(site, owner, ownerSpeaks, 3, [{ speaker: "person", text: "How's it going?", at: 0 }, { speaker: "lead", text: "Proven; ready for you to ship.", at: 1 }], 0, 125_000);
    expect(table("acc_work_messages").at(-1)).toMatchObject({
      author_kind: "model", author_label: "Voice call",
      body: "**Voice call · 2 min**\n\n**Patrick:** How's it going?\n\n**Team Lead:** Proven; ready for you to ship.",
    });
    expect(table("acc_ledger").at(-1)).toMatchObject({ kind: "voice_call", actor_kind: "person", counts: false });
    // A transcript is a record, not a new question: the lead isn't woken to answer it.
    expect(table("acc_jobs").filter((j) => j.status === "queued")).toHaveLength(0);
  });
});
