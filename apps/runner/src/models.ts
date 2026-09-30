import Anthropic from "@anthropic-ai/sdk";
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Provider } from "@accelerator/domain";

import type { Log } from "./api";

/**
 * One interface for every model (flywheel.md F15):
 *   chat()  — a thinking job (consult, design, plan, judge) on any provider.
 *   agent() — Claude with Claude Code's tools (read, edit, run), via the Agent SDK.
 * Keys are ours (runner env) until customer keys come from the vault.
 */
export type Turn = { role: "user" | "assistant"; content: string };

// Keys not scoped to one workspace must name it; the SDK and the agent both send it.
const workspace = () => process.env.ANTHROPIC_WORKSPACE_ID;

let anthropic: Anthropic | null = null;
const client = () =>
  (anthropic ??= new Anthropic(workspace() ? { defaultHeaders: { "anthropic-workspace-id": workspace()! } } : {}));

const OPENAI_COMPATIBLE: Record<Exclude<Provider, "anthropic">, { base: string; key: string }> = {
  openai: { base: "https://api.openai.com/v1", key: "OPENAI_API_KEY" },
  xai: { base: "https://api.x.ai/v1", key: "XAI_API_KEY" },
  google: { base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "GEMINI_API_KEY" },
};

export async function chat(provider: Provider, model: string, system: string, turns: Turn[]): Promise<string> {
  if (provider === "anthropic") {
    // Server-side refusal fallback on (routes a declined request to a fallback model in the same call).
    const message = await client()
      .beta.messages.stream({
        model, max_tokens: 32000, system, messages: turns, output_config: { effort: "high" },
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      })
      .finalMessage();
    if (message.stop_reason === "refusal") throw new Error("The model declined this request.");
    return message.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  }
  const p = OPENAI_COMPATIBLE[provider];
  const key = process.env[p.key];
  if (!key) throw new Error(`${p.key} isn't set on the runner, so ${provider} models can't be used yet.`);
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...turns] }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const data = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${data.error?.message ?? "request failed"}`);
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Key files (.env, .env.local, …) but not the harmless .env.example list. */
export const SECRET_FILE = /\.env(?!\.example\b)(\.[\w.-]+|\b)/;

/** Commands the builder may never run: publishing, touching main, or reading secrets. */
export const FORBIDDEN: [RegExp, string][] = [
  [/\bgit\s+push\b/, "The runner pushes branches, not the model."],
  [/\bgit\s+(checkout|switch|merge|rebase|reset\s+--hard)\b.*\b(main|master|stage)\b/, "Work stays on this Work item's branch."],
  [/\bgit\s+(commit|branch\s+-D|worktree)\b/, "The runner commits and manages branches."],
  [SECRET_FILE, "Keys stay out of the model's context."],
  [/\b(vercel|gh|supabase)\s+/, "Deploys and platform settings go through the Control Room."],
  [/\brm\s+-rf\s+(\/|~|\.\.)/, "Not outside the working copy."],
];

export type AgentResult = { text: string; costUsd: number; ok: boolean; reason?: string };

export async function agent(opts: {
  cwd: string;
  model: string;
  append: string;
  prompt: string;
  mode: "read" | "build";
  log: Log;
  maxTurns?: number;
  maxBudgetUsd?: number;
}): Promise<AgentResult> {
  const readOnly = ["Read", "Glob", "Grep"];
  const guard = async (tool: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    if (tool === "Bash") {
      const cmd = String(input.command ?? "");
      const hit = FORBIDDEN.find(([re]) => re.test(cmd));
      if (hit) {
        opts.log.tool(`Refused: ${cmd.slice(0, 120)} (${hit[1]})`);
        return { behavior: "deny", message: hit[1] };
      }
    }
    if ((tool === "Read" || tool === "Grep") && SECRET_FILE.test(String(input.file_path ?? input.path ?? ""))) {
      return { behavior: "deny", message: "Keys stay out of the model's context." };
    }
    return { behavior: "allow" };
  };

  const stream = query({
    prompt: opts.prompt,
    options: {
      cwd: opts.cwd,
      model: opts.model,
      systemPrompt: { type: "preset", preset: "claude_code", append: opts.append },
      settingSources: ["project"], // the site's CLAUDE.md is its rulebook
      tools: opts.mode === "read" ? readOnly : [...readOnly, "Write", "Edit", "Bash"],
      permissionMode: opts.mode === "read" ? "dontAsk" : "acceptEdits",
      allowedTools: opts.mode === "read" ? readOnly : [...readOnly, "Write", "Edit"],
      canUseTool: guard,
      maxTurns: opts.maxTurns ?? (opts.mode === "read" ? 20 : 80),
      maxBudgetUsd: opts.maxBudgetUsd ?? (opts.mode === "read" ? 2 : 8),
      effort: "high",
      env: { ...process.env, ...(workspace() && { ANTHROPIC_CUSTOM_HEADERS: `anthropic-workspace-id: ${workspace()}` }), CLAUDE_AGENT_SDK_CLIENT_APP: "accelerator-runner/0.1" },
    },
  });

  let text = "";
  for await (const m of stream) {
    if (m.type === "assistant") {
      for (const b of m.message.content) {
        if (b.type === "text" && b.text.trim()) opts.log.log(b.text.trim());
        if (b.type === "tool_use") opts.log.tool(describeTool(b.name, b.input as Record<string, unknown>));
      }
    } else if (m.type === "result") {
      const ok = m.subtype === "success" && !m.is_error;
      text = m.subtype === "success" ? m.result : "";
      opts.log.status(`${ok ? "Finished" : `Stopped (${m.subtype})`} after ${m.num_turns} turns · $${m.total_cost_usd.toFixed(2)}`);
      return { text, costUsd: m.total_cost_usd, ok, reason: ok ? undefined : m.subtype };
    }
  }
  return { text, costUsd: 0, ok: false, reason: "The agent ended without a result." };
}

function describeTool(name: string, input: Record<string, unknown>): string {
  const path = String(input.file_path ?? input.path ?? input.pattern ?? "");
  if (name === "Bash") return `Run: ${String(input.command ?? "").slice(0, 200)}`;
  if (name === "Edit" || name === "Write") return `${name === "Write" ? "Write" : "Edit"} ${path}`;
  if (name === "Read") return `Read ${path}`;
  return `${name} ${path}`.trim();
}
