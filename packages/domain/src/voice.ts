import { COMPLEXITY_LABEL, COMPLEXITY_PROMISE } from "./complexity";
import { progressFor } from "./cockpit";
import type { WorkDetail } from "./flywheel";

/**
 * Live voice in the Work item cockpit (gen2-crew.md §19.1, F3e): the person
 * talks with the Team Lead about one Work item over OpenAI's realtime API.
 * Borrowed from Machine Shop's Talk mode, with the access code replaced by the
 * member's session. Voice uses the same records and the same decision rules as
 * typing: it can brief, pass requests to the crew, pause and resume, and answer
 * a pending decision the person confirmed aloud; never an Owner-gated one. The
 * OpenAI key stays on the server; the browser gets a one-call pass.
 */

// ── Configuration ────────────────────────────────────────────────────────────
export const VOICE_DEFAULT_MODEL = "gpt-realtime";
export const VOICE_DEFAULT_MINUTES = 15;
export const REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export type VoiceSettings = { model: string; minutes: number };

/** The voice settings from the environment, or the missing variable's name. */
export function voiceSettings(env: Record<string, string | undefined>): VoiceSettings | { missing: string } {
  if (!env.OPENAI_API_KEY?.trim()) return { missing: "OPENAI_API_KEY" };
  const minutes = Number(env.VOICE_MAX_MINUTES);
  return {
    model: env.VOICE_MODEL?.trim() || VOICE_DEFAULT_MODEL,
    minutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 60 ? Math.round(minutes) : VOICE_DEFAULT_MINUTES,
  };
}

// ── The lead on a live call ──────────────────────────────────────────────────
export const VOICE_TOOLS = [
  {
    name: "get_status",
    description: "Read where this Work item stands right now: its milestones, the decision waiting on the person (if any) and what the crew is doing. Call it before answering any question about progress.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "send_to_crew",
    description:
      "Pass the person's request, feedback or answer to the crew, in their words, as a message in this Work item's conversation. The crew acts on it as if they had typed it. Use it for anything that should change the work.",
    parameters: {
      type: "object",
      properties: { message: { type: "string", description: "The request in the person's words, complete enough to act on without the call." } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "pause_crew",
    description: "Stop the crew starting anything new on this item (running work finishes). Use when the person says stop, wait or pause.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "resume_crew",
    description: "Let a paused crew carry on.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "answer_decision",
    description:
      "Approve the decision waiting on the person, after you have read its title back and the person has clearly said yes to that decision. Pass the decision_key from get_status. The platform refuses anything that touches money, data, sign-in or security; those need the person's button.",
    parameters: {
      type: "object",
      properties: { decision_key: { type: "string", description: "The decision's key, exactly as get_status returned it." } },
      required: ["decision_key"],
      additionalProperties: false,
    },
  },
] as const;

export type VoiceToolName = (typeof VOICE_TOOLS)[number]["name"];
export const isVoiceTool = (name: string): name is VoiceToolName => VOICE_TOOLS.some((t) => t.name === name);

const VOICE_STYLE =
  "You are speaking aloud on a live call. Keep replies to one to three short sentences in plain spoken language: no lists, markdown, links, code or symbols. If the person interrupts, stop and answer what they just said.";

/** What the lead knows about the item when the call starts, in plain words. */
export function voiceInstructions(d: WorkDetail, siteName: string, personName: string): string {
  const w = d.work;
  const now = progressFor(d).find((m) => m.state !== "done");
  const recent = d.messages
    .slice(-10)
    .map((m) => `${m.authorKind === "person" ? m.authorLabel : m.authorKind === "model" ? "Team Lead" : "Platform"}: ${m.body.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");
  return `You are the Team Lead of the Accelerator crew for ${siteName}, on a live voice call with ${personName} about Work item #${w.number}: "${w.title}".
${VOICE_STYLE}

What you know when the call starts (call get_status for anything current):
- Complexity: ${COMPLEXITY_LABEL[w.complexity]}. ${COMPLEXITY_PROMISE[w.complexity]}
- Where it is: ${now ? `${now.label} (${now.note})` : "Live and checked"}.
- ${d.decision ? `Waiting on the person: ${d.decision.title}${d.decision.ownerOnly ? " (button only: it touches money, data, sign-in or security)" : ""}.` : "Nothing is waiting on the person."}
${w.paused ? "- The crew is paused.\n" : ""}
The conversation so far (most recent last):
${recent || "(none yet)"}

How you work on this call:
- You speak for the crew, but the crew does the work. Anything that should change the work goes to the crew with send_to_crew, in the person's words. Say plainly that you've passed it on.
- Never claim something is built, proven or live unless get_status says so.
- Decisions: read the waiting decision's title back and ask. Only if the person clearly says yes to that decision, call answer_decision with its key. Never approve anything touching money, data, sign-in or security; tell the person to use the button.
- If the person says stop, wait or pause, call pause_crew. Resume only when they ask.
- Business language; technical detail only when asked.`;
}

/** The `session` for OpenAI's client-secret request: spoken style, the five tools, and transcription for captions. */
export function voiceSession(model: string, instructions: string) {
  return {
    type: "realtime" as const,
    model,
    instructions,
    output_modalities: ["audio"],
    max_output_tokens: 1024,
    audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad" } } },
    tools: VOICE_TOOLS.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters })),
    tool_choice: "auto" as const,
  };
}

// ── Live call events (browser) ───────────────────────────────────────────────
export type VoiceSpeaker = "person" | "lead";
export type VoiceToolCall = { callId: string; name: string; arguments: string };
export type VoiceEvent =
  | { kind: "caption"; id: string; speaker: VoiceSpeaker; text: string; mode: "start" | "append" | "final" }
  | { kind: "response_started" }
  | { kind: "response_done"; calls: VoiceToolCall[] }
  | { kind: "error"; message: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** What one realtime data-channel event means for the cockpit; anything else is null. */
export function readVoiceEvent(raw: unknown): VoiceEvent | null {
  let e: unknown = raw;
  if (typeof raw === "string") {
    try {
      e = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!e || typeof e !== "object") return null;
  const ev = e as Record<string, unknown>;
  const id = str(ev.item_id);
  switch (ev.type) {
    case "input_audio_buffer.committed":
      return id ? { kind: "caption", id, speaker: "person", text: "", mode: "start" } : null;
    case "conversation.item.input_audio_transcription.delta":
      return id ? { kind: "caption", id, speaker: "person", text: str(ev.delta), mode: "append" } : null;
    case "conversation.item.input_audio_transcription.completed":
      return id ? { kind: "caption", id, speaker: "person", text: str(ev.transcript), mode: "final" } : null;
    case "response.output_audio_transcript.delta":
      return id ? { kind: "caption", id, speaker: "lead", text: str(ev.delta), mode: "append" } : null;
    case "response.output_audio_transcript.done":
      return id ? { kind: "caption", id, speaker: "lead", text: str(ev.transcript), mode: "final" } : null;
    case "response.created":
      return { kind: "response_started" };
    case "response.done": {
      const output = (ev.response as { output?: unknown } | undefined)?.output;
      const calls: VoiceToolCall[] = [];
      for (const item of Array.isArray(output) ? output : []) {
        const it = item as Record<string, unknown> | null;
        if (it?.type !== "function_call" || it.status === "incomplete") continue;
        const callId = str(it.call_id);
        const name = str(it.name);
        if (callId && name) calls.push({ callId, name, arguments: str(it.arguments) });
      }
      return { kind: "response_done", calls };
    }
    case "error":
      return { kind: "error", message: str((ev.error as { message?: unknown } | undefined)?.message) || "Unknown error" };
    default:
      return null;
  }
}

export type VoiceCaption = { id: string; speaker: VoiceSpeaker; text: string; at: number; final: boolean };

/** Applies one caption event: captions grow as words stream in and are final once. */
export function applyVoiceCaption(captions: VoiceCaption[], e: Extract<VoiceEvent, { kind: "caption" }>, now: number): VoiceCaption[] {
  const i = captions.findIndex((c) => c.id === e.id);
  const existing = i >= 0 ? captions[i]! : null;
  if (existing?.final) return captions;
  const base = existing ?? { id: e.id, speaker: e.speaker, text: "", at: now, final: false };
  const text = e.mode === "final" ? e.text.trim() : e.mode === "append" ? base.text + e.text : base.text;
  const next: VoiceCaption = { ...base, text, final: e.mode === "final" };
  return i >= 0 ? captions.map((c, j) => (j === i ? next : c)) : [...captions, next];
}

export const toolOutputEvents = (outputs: { callId: string; output: string }[]) => [
  ...outputs.map((o) => ({ type: "conversation.item.create", item: { type: "function_call_output", call_id: o.callId, output: o.output } })),
  { type: "response.create" },
];

export const VOICE_TIME_WARNING = "The call ends in about a minute. In one short sentence, say time is nearly up and offer to pass anything outstanding to the crew.";

export const timeWarningEvents = (responding: boolean) => [
  { type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: VOICE_TIME_WARNING }] } },
  ...(responding ? [] : [{ type: "response.create" }]),
];

export const formatClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ── The saved transcript ─────────────────────────────────────────────────────
export type VoiceLine = { speaker: VoiceSpeaker; text: string; at: number };

/** The call's transcript as one conversation message, so voice and text share one record. */
export function voiceTranscript(lines: VoiceLine[], personName: string, startedAt: number, endedAt: number): string {
  const kept = lines.filter((l) => l.text.trim()).slice(0, 400);
  const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
  const body = kept.map((l) => `**${l.speaker === "person" ? personName : "Team Lead"}:** ${l.text.trim().slice(0, 2000)}`).join("\n\n");
  return `**Voice call · ${minutes} min**\n\n${body || "_Nothing was said._"}`;
}
