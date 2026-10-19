import { describe, expect, it } from "vitest";

import { DEFAULT_MODELS, resolveModels, type WorkActions, type WorkDetail } from "./flywheel";
import {
  applyVoiceCaption, formatClock, isVoiceTool, readVoiceEvent, timeWarningEvents, toolOutputEvents, VOICE_TOOLS, voiceInstructions, voiceSession, voiceSettings, voiceTranscript,
} from "./voice";

const at = "2026-10-19T12:00:00Z";
const actions = {
  ask: true, begin: false, draftDesign: false, approveDesign: false, draftPlan: false, approvePlan: false, runNextStep: false,
  nextStep: null, prove: false, approveTry: false, release: false, ship: true, close: false, cancel: true,
} satisfies WorkActions;
const detail = (extra: Partial<WorkDetail> = {}): WorkDetail => ({
  work: {
    id: "w", number: 12, kind: "change", title: "Faster quote form", stage: "try", risk: [], complexity: "medium", recommendedComplexity: "medium",
    complexityReason: null, complexitySetBy: "platform", ready: true, autoShip: false, paused: false, proofRepairs: 0, branch: null, planApproved: true,
    previewUrl: "https://p", proof: null, tryApproved: false, released: false, release: null, createdAt: at, updatedAt: at,
  },
  messages: [
    { id: "m1", authorKind: "person", authorLabel: "Patrick", model: null, stage: "discuss", body: "Make the quote form faster on phones.", createdAt: at },
    { id: "m2", authorKind: "model", authorLabel: "Claude", model: "m", stage: "discuss", body: "Medium: I'll write a short Brief.", createdAt: at },
  ],
  designs: [], steps: [], jobs: [], events: [], actions, crewNext: null,
  decision: { kind: "ship", key: "ship:abc123", title: "Ship it (abc123)", action: "Ship it", ownerOnly: false, needsRelease: true },
  models: resolveModels(DEFAULT_MODELS), runnerOnline: true, ...extra,
});

describe("voiceSettings", () => {
  it("needs the OpenAI key; model and minutes have safe defaults", () => {
    expect(voiceSettings({})).toEqual({ missing: "OPENAI_API_KEY" });
    expect(voiceSettings({ OPENAI_API_KEY: "sk" })).toEqual({ model: "gpt-realtime", minutes: 15 });
    expect(voiceSettings({ OPENAI_API_KEY: "sk", VOICE_MODEL: "gpt-realtime-mini", VOICE_MAX_MINUTES: "8" })).toEqual({ model: "gpt-realtime-mini", minutes: 8 });
    expect(voiceSettings({ OPENAI_API_KEY: "sk", VOICE_MAX_MINUTES: "500" })).toMatchObject({ minutes: 15 });
  });
});

describe("the lead's call instructions", () => {
  it("ground the lead in the item, its pending decision and the conversation", () => {
    const s = voiceInstructions(detail(), "Machine Shop", "Patrick");
    expect(s).toContain('Work item #12: "Faster quote form"');
    expect(s).toContain("Complexity: Medium.");
    expect(s).toContain("Waiting on the person: Ship it (abc123).");
    expect(s).toContain("Patrick: Make the quote form faster on phones.");
    expect(s).toContain("Team Lead: Medium: I'll write a short Brief.");
    expect(s).toContain("Never approve anything touching money, data, sign-in or security");
  });
  it("mark an Owner-gated decision as button only, and say when the crew is paused", () => {
    const d = detail({ decision: { kind: "approve_try", key: "approve_try:x", title: "Approve the preview for release (x)", action: "Approve for release", ownerOnly: true, needsRelease: false } });
    d.work.paused = true;
    const s = voiceInstructions(d, "Machine Shop", "Patrick");
    expect(s).toContain("(button only: it touches money, data, sign-in or security)");
    expect(s).toContain("The crew is paused.");
  });
  it("give the session exactly the five narrow tools, and nothing broader", () => {
    const session = voiceSession("gpt-realtime", "x");
    expect(session.tools.map((t) => t.name)).toEqual(["get_status", "send_to_crew", "pause_crew", "resume_crew", "answer_decision"]);
    expect(VOICE_TOOLS.every((t) => t.parameters.additionalProperties === false)).toBe(true);
    expect(isVoiceTool("send_to_crew")).toBe(true);
    expect(isVoiceTool("release")).toBe(false);
  });
});

describe("live events and captions", () => {
  it("streams the person's and the lead's words into captions that end final once", () => {
    let c = applyVoiceCaption([], readVoiceEvent({ type: "input_audio_buffer.committed", item_id: "a" }) as never, 1);
    c = applyVoiceCaption(c, readVoiceEvent({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "How's " }) as never, 2);
    c = applyVoiceCaption(c, readVoiceEvent({ type: "conversation.item.input_audio_transcription.delta", item_id: "a", delta: "it going?" }) as never, 3);
    expect(c).toEqual([{ id: "a", speaker: "person", text: "How's it going?", at: 1, final: false }]);
    c = applyVoiceCaption(c, readVoiceEvent(JSON.stringify({ type: "response.output_audio_transcript.done", item_id: "b", transcript: " Proven and ready. " })) as never, 4);
    expect(c[1]).toEqual({ id: "b", speaker: "lead", text: "Proven and ready.", at: 4, final: true });
    expect(applyVoiceCaption(c, { kind: "caption", id: "b", speaker: "lead", text: "late", mode: "append" }, 5)).toBe(c);
  });
  it("reads tool calls from a finished response and ignores noise", () => {
    expect(readVoiceEvent({ type: "response.done", response: { output: [{ type: "function_call", call_id: "c1", name: "get_status", arguments: "{}" }, { type: "message" }] } })).toEqual({
      kind: "response_done", calls: [{ callId: "c1", name: "get_status", arguments: "{}" }],
    });
    expect(readVoiceEvent("not json")).toBeNull();
    expect(readVoiceEvent({ type: "rate_limits.updated" })).toBeNull();
  });
  it("hands tool results back and asks for the reply once", () => {
    expect(toolOutputEvents([{ callId: "c1", output: "{}" }])).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: "{}" } },
      { type: "response.create" },
    ]);
    expect(timeWarningEvents(true)).toHaveLength(1);
    expect(formatClock(61_000)).toBe("1:01");
  });
});

describe("voiceTranscript", () => {
  it("saves the call as one readable message with who said what", () => {
    const t = voiceTranscript(
      [{ speaker: "person", text: "How's it going?", at: 0 }, { speaker: "lead", text: "Proven and ready to ship.", at: 1 }, { speaker: "lead", text: "  ", at: 2 }],
      "Patrick", 0, 185_000,
    );
    expect(t).toBe("**Voice call · 3 min**\n\n**Patrick:** How's it going?\n\n**Team Lead:** Proven and ready to ship.");
    expect(voiceTranscript([], "Patrick", 0, 10_000)).toBe("**Voice call · 1 min**\n\n_Nothing was said._");
  });
});
