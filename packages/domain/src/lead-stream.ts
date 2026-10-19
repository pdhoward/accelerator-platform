/**
 * Streaming the Team Lead's typed reply (gen2-crew.md §17 F4, §19.2). The lead
 * ends each reply with hidden assessment lines (COMPLEXITY / READY / REASON,
 * read by readAssessment); while the reply streams, those lines must never
 * reach the screen. This filter passes text through as it arrives, holding
 * back only a line that could still turn out to be one of them.
 */

const TRAILER = /^\s*(COMPLEXITY|READY|REASON)\s*:/i;
const KEYS = ["COMPLEXITY:", "READY:", "REASON:"];

/** Could this partial line still become a trailer line? */
function mightBeTrailer(partial: string): boolean {
  const t = partial.trimStart().toUpperCase().replace(/\s+:/, ":");
  if (!t) return true; // only whitespace so far: wait for more
  return KEYS.some((k) => k.startsWith(t) || t.startsWith(k));
}

export function trailerFilter() {
  let line = "";
  return {
    /** Feed a chunk; returns the text that is safe to show now. */
    push(chunk: string): string {
      let out = "";
      line += chunk;
      let nl = line.indexOf("\n");
      while (nl >= 0) {
        const full = line.slice(0, nl);
        if (!TRAILER.test(full)) out += `${full}\n`;
        line = line.slice(nl + 1);
        nl = line.indexOf("\n");
      }
      // A partial line is shown at once unless it could still be the start of a hidden line.
      if (line && !mightBeTrailer(line)) {
        out += line;
        line = "";
      }
      return out;
    },
    /** The stream ended: whatever is held back, unless it is a trailer line. */
    flush(): string {
      const rest = line;
      line = "";
      return rest && !TRAILER.test(rest) ? rest : "";
    },
  };
}

/** One server-sent event for a streamed reply. */
export type LeadStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "handled"; note: string }
  | { type: "queued"; note: string }
  | { type: "error"; message: string };

export const sse = (e: LeadStreamEvent) => `data: ${JSON.stringify(e)}\n\n`;

/** Reads server-sent events out of a growing buffer; returns the events and what's left over. */
export function readSse(buffer: string): { events: LeadStreamEvent[]; rest: string } {
  const events: LeadStreamEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as LeadStreamEvent);
    } catch {
      /* ignore a malformed event */
    }
  }
  return { events, rest };
}
