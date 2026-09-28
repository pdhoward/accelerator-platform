import type { RequestType, RiskClass } from "@accelerator/domain";

/**
 * Placeholder for the routing model: keyword triage of a new request.
 * The real router is a fast classifier; gate policy (packages/domain) still
 * decides what needs a human, whatever this returns.
 */
export function triage(text: string): { type: RequestType; risk: RiskClass[] } {
  const t = text.toLowerCase();
  if (/refund|price|tax|charge|payment|fee|invoice/.test(t)) return { type: "bug", risk: ["money"] };
  if (/report|total|number|data|record|database/.test(t)) return { type: "data", risk: ["data"] };
  if (/slow|speed|load|lighthouse/.test(t)) return { type: "performance", risk: ["code"] };
  if (/photo|image|picture|copy|text|wording|typo/.test(t)) return { type: "content", risk: ["content"] };
  if (/button|layout|mobile|design|look/.test(t)) return { type: "design", risk: ["display"] };
  return { type: "feature", risk: ["code"] };
}

export function requestTitle(text: string) {
  const t = text.trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}
