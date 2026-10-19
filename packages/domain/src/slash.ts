import { isComplexity, type Complexity } from "./complexity";

/**
 * Slash commands in the Work item conversation (gen2-crew.md §17 F5): short,
 * exact shortcuts for things a person already can do. A command never grants
 * anything: /ship and /approve become the typed decision ("ship it",
 * "approve"), bound to the card on screen and checked by the server exactly
 * like typing them.
 */
export type SlashCommand =
  | { kind: "say"; body: string } // sent as a message, e.g. a typed decision
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "tier"; complexity: Complexity }
  | { kind: "open"; panel: "design" | "plan" | "ship" | "log" }
  | { kind: "talk" }
  | { kind: "help" }
  | { kind: "unknown"; text: string };

export const SLASH_HELP: { command: string; does: string }[] = [
  { command: "/ship", does: "Ship it (the decision on screen, when it's yours to make)" },
  { command: "/approve", does: "Approve the decision on screen" },
  { command: "/pause", does: "Stop the crew starting anything new" },
  { command: "/resume", does: "Let the crew carry on" },
  { command: "/tier low|medium|high", does: "Set the complexity (never below the risk floor)" },
  { command: "/brief", does: "Open the Brief or design" },
  { command: "/plan", does: "Open the plan" },
  { command: "/proof", does: "Open proof and release" },
  { command: "/log", does: "Open the live log" },
  { command: "/talk", does: "Start a live voice call" },
  { command: "/help", does: "List these commands" },
];

/** The command a message is, or null when it isn't a slash command at all. */
export function readSlash(text: string): SlashCommand | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [head = "", ...rest] = t.slice(1).split(/\s+/);
  const arg = rest.join(" ").toLowerCase();
  switch (head.toLowerCase()) {
    case "ship":
      return { kind: "say", body: "ship it" };
    case "approve":
      return { kind: "say", body: "approve" };
    case "pause":
    case "stop":
      return { kind: "pause" };
    case "resume":
      return { kind: "resume" };
    case "tier":
    case "complexity":
      return isComplexity(arg) ? { kind: "tier", complexity: arg } : { kind: "unknown", text: t };
    case "brief":
    case "design":
      return { kind: "open", panel: "design" };
    case "plan":
      return { kind: "open", panel: "plan" };
    case "proof":
    case "release":
      return { kind: "open", panel: "ship" };
    case "log":
      return { kind: "open", panel: "log" };
    case "talk":
    case "call":
      return { kind: "talk" };
    case "help":
    case "?":
      return { kind: "help" };
    default:
      return { kind: "unknown", text: t };
  }
}
