"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Phone } from "lucide-react";
import {
  applyVoiceCaption, formatClock, readVoiceEvent, REALTIME_CALLS_URL, timeWarningEvents, toolOutputEvents,
  type VoiceCaption, type VoiceToolCall,
} from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { button, cx } from "../ui";

/**
 * Live voice in the Work item conversation (gen2-crew.md §19.1, F3e), adapted
 * from Machine Shop's Talk mode. The browser gets a one-call pass from the API,
 * talks to OpenAI over WebRTC, runs the lead's tools through the API with the
 * person's own authority, streams captions into the conversation, and saves the
 * transcript there when the call ends.
 */

type Phase = "idle" | "connecting" | "live";
type Live = { pc: RTCPeerConnection; dc: RTCDataChannel; mic: MediaStream; audio: HTMLAudioElement; startedAt: number; endsAt: number };

/** Tools that change the work: the conversation refreshes after them. */
const CHANGES_WORK = new Set(["send_to_crew", "pause_crew", "resume_crew", "answer_decision"]);
const WARN_MS = 60_000;

const MIC: Record<"blocked" | "unsupported", string> = {
  blocked: "The microphone is blocked. Allow it in your browser's site settings to talk, or type instead.",
  unsupported: "Live voice needs a microphone and a browser that supports calls. Type instead.",
};

export function useVoiceCall({ siteId, number, onChanged }: { siteId: string; number: number; onChanged: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [captions, setCaptions] = useState<VoiceCaption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(0);
  const live = useRef<Live | null>(null);
  const responding = useRef(false);
  const warned = useRef(false);
  const lines = useRef<VoiceCaption[]>([]);
  // Held in a ref so a new callback from the parent never ends a live call (the cleanup below calls hangUp).
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const send = (events: object[]) => {
    const dc = live.current?.dc;
    if (dc?.readyState === "open") for (const e of events) dc.send(JSON.stringify(e));
  };

  const hangUp = useCallback(async () => {
    const call = live.current;
    if (!call) return;
    live.current = null;
    call.dc.close();
    call.pc.close();
    call.mic.getTracks().forEach((t) => t.stop());
    call.audio.srcObject = null;
    setPhase("idle");
    setMuted(false);
    const said = lines.current.filter((c) => c.text.trim());
    lines.current = [];
    if (said.length) {
      await browserApi()
        .work.voice.transcript(siteId, number, { lines: said.map((c) => ({ speaker: c.speaker, text: c.text, at: c.at })), startedAt: call.startedAt, endedAt: Date.now() })
        .catch(() => setError("The call ended, but its transcript couldn't be saved."));
    }
    setCaptions([]);
    changed.current();
  }, [siteId, number]);

  async function runTools(calls: VoiceToolCall[]) {
    const outputs = await Promise.all(
      calls.map(async (c) => {
        try {
          const { output } = await browserApi().work.voice.tool(siteId, number, { name: c.name, arguments: c.arguments });
          return { callId: c.callId, output };
        } catch {
          return { callId: c.callId, output: JSON.stringify({ error: "Couldn't reach the Accelerator just now." }) };
        }
      }),
    );
    if (!live.current) return;
    send(toolOutputEvents(outputs));
    if (calls.some((c) => CHANGES_WORK.has(c.name))) changed.current();
  }

  function onEvent(raw: unknown) {
    const e = readVoiceEvent(raw);
    if (!e) return;
    if (e.kind === "caption") {
      setCaptions((cs) => {
        const next = applyVoiceCaption(cs, e, Date.now());
        lines.current = next;
        return next;
      });
    } else if (e.kind === "response_started") responding.current = true;
    else if (e.kind === "response_done") {
      responding.current = false;
      if (e.calls.length) void runTools(e.calls);
    } else console.warn("[voice]", e.message);
  }

  async function start() {
    if (live.current || phase !== "idle") return;
    setError(null);
    if (typeof navigator.mediaDevices?.getUserMedia !== "function" || typeof RTCPeerConnection !== "function") return setError(MIC.unsupported);
    // Inside the tap: let the audio element play later (iPhone Safari needs a gesture).
    const audio = new Audio();
    audio.autoplay = true;
    void audio.play().catch(() => {});
    setPhase("connecting");
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
      setPhase("idle");
      return setError(name === "NotAllowedError" || name === "SecurityError" ? MIC.blocked : MIC.unsupported);
    }
    let pass: { pass: string; endsAt: string };
    try {
      pass = await browserApi().work.voice.start(siteId, number);
    } catch (err) {
      mic.getTracks().forEach((t) => t.stop());
      setPhase("idle");
      return setError(err instanceof Error ? err.message : "Live voice hit a snag. Try again, or type instead.");
    }
    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel("oai-events");
    live.current = { pc, dc, mic, audio, startedAt: Date.now(), endsAt: Date.parse(pass.endsAt) };
    warned.current = false;
    responding.current = false;
    lines.current = [];
    setCaptions([]);
    try {
      pc.ontrack = (ev) => {
        audio.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
        void audio.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setError("The call dropped. You can keep typing.");
          void hangUp();
        }
      };
      for (const t of mic.getTracks()) pc.addTrack(t, mic);
      dc.onmessage = (ev) => onEvent(ev.data);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await fetch(REALTIME_CALLS_URL, { method: "POST", body: offer.sdp, headers: { Authorization: `Bearer ${pass.pass}`, "Content-Type": "application/sdp" } });
      if (!answer.ok) throw new Error(`OpenAI answered ${answer.status}`);
      await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    } catch (err) {
      console.error("[voice]", err);
      await hangUp();
      return setError("Live voice hit a snag connecting. Try again, or type instead.");
    }
    if (live.current?.pc !== pc) return;
    setNow(Date.now());
    setPhase("live");
  }

  function toggleMute() {
    const call = live.current;
    if (!call) return;
    const next = !muted;
    call.mic.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  // The call timer: a warning a minute before the end, then hang up at 0:00.
  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => {
      const call = live.current;
      if (!call) return;
      const t = Date.now();
      setNow(t);
      const left = call.endsAt - t;
      if (left <= WARN_MS && !warned.current) {
        warned.current = true;
        send(timeWarningEvents(responding.current));
      }
      if (left <= 0) void hangUp();
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs
  }, [phase, hangUp]);

  // Hang up if the page goes away mid-call.
  useEffect(() => {
    const onLeave = () => void hangUp();
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      void hangUp();
    };
  }, [hangUp]);

  const remaining = live.current ? live.current.endsAt - now : 0;
  return { phase, captions, error, muted, remaining, start, hangUp, toggleMute, clearError: () => setError(null) };
}

export type VoiceCall = ReturnType<typeof useVoiceCall>;

/** The Talk button, the live bar while a call is on, and any problem in plain words. */
export function VoiceBar({ call }: { call: VoiceCall }) {
  if (call.phase === "idle") {
    return call.error ? (
      <p role="alert" className="border-b border-line bg-warn/5 px-4 py-2 text-[12.5px] text-warn">
        {call.error}
      </p>
    ) : null;
  }
  if (call.phase === "connecting") {
    return (
      <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] text-fog">
        <Loader2 className="size-4 animate-spin" /> Connecting… allow the microphone if your browser asks.
      </p>
    );
  }
  const final = call.remaining <= WARN_MS;
  return (
    <div className="flex items-center gap-3 border-b border-good/25 bg-good/[0.06] py-2 pl-4 pr-2">
      <span aria-hidden className="relative flex size-2.5">
        <span className="absolute inset-0 rounded-full bg-good/60 motion-safe:animate-ping" />
        <span className="relative size-2.5 rounded-full bg-good" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[13.5px] font-semibold">Live with the Team Lead</p>
        <p className="text-[11.5px] text-mist">{call.muted ? "You're muted." : "Just talk. Captions appear below, and the transcript is saved here."}</p>
      </div>
      <span role="timer" aria-label={`Time left ${formatClock(call.remaining)}`} className={cx("tabular-nums", final ? "font-semibold text-warn" : "text-fog")}>
        {formatClock(call.remaining)}
      </span>
      <button type="button" onClick={call.toggleMute} aria-pressed={call.muted} aria-label={call.muted ? "Unmute" : "Mute"} title={call.muted ? "Unmute" : "Mute"} className={button("ghost", "size-9 p-0")}>
        {call.muted ? <MicOff className="size-4 text-warn" /> : <Mic className="size-4" />}
      </button>
      <button
        type="button"
        onClick={() => void call.hangUp()}
        aria-label="Hang up"
        title="Hang up"
        className="grid size-10 shrink-0 place-items-center rounded-full bg-bad text-white shadow-[0_6px_16px_-6px_var(--color-bad)] transition-transform hover:scale-105"
      >
        <Phone className="size-[18px] rotate-[135deg]" fill="currentColor" strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** The call's words as they stream: the person on the right, the lead on the left, like the conversation. */
export function LiveCaptions({ captions, person }: { captions: VoiceCaption[]; person: string }) {
  if (!captions.length) return null;
  return (
    <div role="log" aria-live="polite" aria-label="Live captions" className="flex flex-col gap-3 border-t border-dashed border-good/25 pt-3">
      {captions.map((c) => (
        <div key={c.id} className={cx("flex", c.speaker === "person" && "justify-end")}>
          <p
            className={cx(
              "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed",
              c.speaker === "person" ? "rounded-tr-md bg-violet/12" : "rounded-tl-md bg-good/10",
              !c.final && "opacity-80",
            )}
          >
            <span className="mb-0.5 block text-[11px] text-mist">{c.speaker === "person" ? person : "Team Lead"} · voice</span>
            {c.text || "…"}
            {!c.final && <span aria-hidden className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-current/60 motion-safe:animate-pulse" />}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Talk: starts a live voice call on this item. */
export function TalkButton({ call, disabled }: { call: VoiceCall; disabled?: boolean }) {
  if (call.phase !== "idle") return null;
  return (
    <button
      type="button"
      onClick={() => void call.start()}
      disabled={disabled}
      title="Talk with the Team Lead about this item"
      className="inline-flex items-center gap-1.5 rounded-full bg-good px-3 py-1 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      <Phone className="size-3.5" fill="currentColor" strokeWidth={1.5} /> Talk
    </button>
  );
}
