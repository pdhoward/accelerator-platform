/**
 * The Team Lead's streamed reply (gen2-crew.md §17 F4): Anthropic's Messages
 * API with `stream: true`, read as server-sent events. Raw HTTP keeps the API
 * free of an SDK dependency; `fetchImpl` lets tests stand in for the network.
 */

export type Turn = { role: "user" | "assistant"; content: string };

export async function streamAnthropic(
  opts: { model: string; system: string; turns: Turn[]; maxTokens?: number; signal?: AbortSignal },
  onText: (text: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY isn't set on the API.");
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      ...(process.env.ANTHROPIC_WORKSPACE_ID && { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }),
    },
    body: JSON.stringify({ model: opts.model, max_tokens: opts.maxTokens ?? 2048, system: opts.system, messages: opts.turns, stream: true }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const event = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      const data = event.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      let e: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
      try {
        e = JSON.parse(data);
      } catch {
        continue;
      }
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
        text += e.delta.text;
        onText(e.delta.text);
      } else if (e.type === "error") throw new Error(e.error?.message ?? "The model stream failed.");
    }
  }
  return text;
}

/** Conversation turns for the lead: alternating roles (consecutive same-role turns merged), starting with the person. */
export function leadTurns(messages: { authorKind: "person" | "model" | "system"; body: string }[], instruction: string, title: string): Turn[] {
  const turns: Turn[] = [];
  const push = (role: Turn["role"], content: string) => {
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  };
  for (const m of messages) {
    if (m.authorKind === "person") push("user", m.body);
    else if (m.authorKind === "model") push("assistant", m.body);
    else push("user", `[Control Room] ${m.body}`);
  }
  if (turns[0]?.role !== "user") turns.unshift({ role: "user", content: `Work item: ${title}` });
  push("user", instruction);
  return turns;
}
