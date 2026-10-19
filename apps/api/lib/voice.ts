import {
  progressFor,
  REALTIME_CLIENT_SECRETS_URL,
  voiceInstructions,
  voiceSession,
  voiceSettings,
  voiceTranscript,
  type Identity,
  type Site,
  type VoiceLine,
} from "@accelerator/domain";

import { demoMode } from "./auth";
import { CodeError } from "./codes";
import { pauseWork, postMessage, recordVoiceCall, resumeWork, workDetail, type Speaker } from "./work";

/**
 * Live voice in the Work item cockpit (gen2-crew.md §19.1, F3e). The server
 * mints a one-call OpenAI pass grounded in the item's real state (the key never
 * reaches the browser); the browser talks to OpenAI over WebRTC; every tool the
 * lead calls runs here, with the caller's own authority, through the same
 * functions and checks as typing.
 */

/** Seconds the browser has to connect with the pass; the call itself is capped by VOICE_MAX_MINUTES. */
const PASS_SECONDS = 60;

export class VoiceUnavailable extends Error {}

export async function startVoiceCall(site: Site, who: Speaker, number: number) {
  if (demoMode()) throw new CodeError("Live voice needs a real Work item, not the illustrative sample.");
  const settings = voiceSettings(process.env);
  if ("missing" in settings) throw new VoiceUnavailable(`Live voice isn't set up on this server yet: ${settings.missing} is missing.`);
  const d = await workDetail(site, number);
  const res = await fetch(REALTIME_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: PASS_SECONDS },
      session: voiceSession(settings.model, voiceInstructions(d, site.name, who.name)),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { value?: unknown; expires_at?: unknown };
  if (!res.ok || typeof data.value !== "string") {
    console.error("[voice] OpenAI refused the pass:", res.status);
    throw new VoiceUnavailable("Live voice hit a snag starting the call. Try again in a moment, or type instead.");
  }
  const now = Date.now();
  return {
    pass: data.value,
    passExpiresAt: typeof data.expires_at === "number" ? new Date(data.expires_at * 1000).toISOString() : new Date(now + PASS_SECONDS * 1000).toISOString(),
    endsAt: new Date(now + settings.minutes * 60_000).toISOString(),
    minutes: settings.minutes,
  };
}

/** Runs one tool the lead called on the call; returns the JSON text handed back to the model. */
export async function runVoiceTool(site: Site, identity: Identity, who: Speaker, number: number, name: string, args: string): Promise<string> {
  const voice: Speaker = { ...who, name: `${who.name} (by voice)` };
  const input = (() => {
    try {
      return (JSON.parse(args || "{}") ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  try {
    switch (name) {
      case "get_status": {
        const d = await workDetail(site, number);
        return JSON.stringify({
          item: `#${d.work.number} ${d.work.title}`,
          complexity: d.work.complexity,
          milestones: progressFor(d).map((m) => ({ step: m.label, state: m.state, note: m.note })),
          waiting_on_person: d.decision ? { title: d.decision.title, decision_key: d.decision.key, button_only: d.decision.ownerOnly } : null,
          crew_doing: d.jobs.some((j) => j.status === "queued" || j.status === "running") ? `working: ${d.jobs[0]!.kind.replace("_", " ")}` : d.crewNext ?? "nothing until someone decides",
          paused: d.work.paused,
        });
      }
      case "send_to_crew": {
        const message = typeof input.message === "string" ? input.message.trim().slice(0, 4000) : "";
        if (!message) return JSON.stringify({ error: "Say what to pass to the crew." });
        await postMessage(site, identity, voice, number, message);
        return JSON.stringify({ ok: true, note: "Passed to the crew in the conversation; they'll act on it." });
      }
      case "pause_crew":
        await pauseWork(site, identity, voice.name, number);
        return JSON.stringify({ ok: true, note: "The crew is paused; nothing new starts until resumed." });
      case "resume_crew":
        await resumeWork(site, identity, voice.name, number);
        return JSON.stringify({ ok: true, note: "The crew carries on." });
      case "answer_decision": {
        const key = typeof input.decision_key === "string" ? input.decision_key : "";
        // Only the decision actually waiting now: a stale or invented key is refused before anything is posted.
        const before = await workDetail(site, number);
        if (!before.decision || before.decision.key !== key) {
          return JSON.stringify({ applied: false, reason: before.decision ? `That decision has changed; what's waiting now is "${before.decision.title}". Check with the person.` : "Nothing is waiting on the person right now." });
        }
        // The same path as a typed "approve": bound to the key, refused when Owner-gated or not the person's to make.
        await postMessage(site, identity, voice, number, "approve", key);
        const after = await workDetail(site, number);
        if (after.decision?.key !== key) return JSON.stringify({ applied: true, note: "Done. The crew carries on from here." });
        const why = after.messages.filter((m) => m.authorKind === "system").at(-1)?.body ?? "The platform didn't apply it.";
        return JSON.stringify({ applied: false, reason: why });
      }
      default:
        return JSON.stringify({ error: `There's no tool called ${name}.` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "That didn't work." });
  }
}

/** The call's transcript, saved as one message in the item's conversation. */
export async function saveVoiceTranscript(site: Site, identity: Identity, who: Speaker, number: number, lines: VoiceLine[], startedAt: number, endedAt: number) {
  await recordVoiceCall(site, identity, who.name, number, voiceTranscript(lines, who.name, startedAt, endedAt), Math.round((endedAt - startedAt) / 1000));
}
