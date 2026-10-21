import { canSite } from "./permissions";
import type { RiskClass, Role } from "./types";

/**
 * Gate policy — deterministic by design. Models may classify a change's risk,
 * but only these rules decide who must approve it. Keep them boring and tested.
 * (The complexity tiers, complexity.ts, decide how many gates a change has.)
 */

/** Risk classes that always need the site Owner's approval. */
export const OWNER_GATED: readonly RiskClass[] = ["money", "data", "auth", "security"];

/** Who may approve a change: the role must hold change.approve, and owner-gated risk needs the Owner. */
export function canApprove(role: Role, risk: RiskClass[]): boolean {
  if (!canSite(role, "change.approve")) return false;
  return risk.some((r) => OWNER_GATED.includes(r)) ? role === "owner" : true;
}
