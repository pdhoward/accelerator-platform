import { canSite } from "./permissions";
import type { AutonomyLevel, EvidenceItem, Gate, RiskClass, Role } from "./types";

/**
 * Gate policy — deterministic by design. Models may classify a change's risk,
 * but only this function decides what needs a human. Keep it boring and tested.
 */

/** Risk classes that always need the site Owner's approval. */
export const OWNER_GATED: readonly RiskClass[] = ["money", "data", "auth", "security"];

/** Risk classes low enough to ship on evidence alone at AC1. */
const EVIDENCE_ONLY: readonly RiskClass[] = ["display", "content"];

export function requiredGates(change: { risk: RiskClass[]; level: AutonomyLevel }): Gate[] {
  const gates: Gate[] = [];
  const lowRiskOnly = change.risk.length > 0 && change.risk.every((r) => EVIDENCE_ONLY.includes(r));

  // AC1 + only display/content changes may ship on evidence; everything else is tried by a person.
  if (!(change.level === "AC1" && lowRiskOnly)) gates.push("try");
  if (change.risk.some((r) => OWNER_GATED.includes(r))) gates.push("owner-approval");
  if (change.risk.includes("data")) gates.push("data-preview");
  return gates;
}

/** Evidence must be all green to leave Prove. A warning is not a pass. */
export function evidenceGreen(evidence: EvidenceItem[]): boolean {
  return evidence.length > 0 && evidence.every((e) => e.status === "pass");
}

export type ShipCheck = { canShip: boolean; blockers: string[] };

export function canShip(input: {
  risk: RiskClass[];
  level: AutonomyLevel;
  evidence: EvidenceItem[];
  tried: boolean;
  approvals: { role: Role }[];
  dataPreviewed?: boolean;
}): ShipCheck {
  const blockers: string[] = [];
  if (!evidenceGreen(input.evidence)) blockers.push("Evidence is not all green.");
  for (const gate of requiredGates(input)) {
    if (gate === "try" && !input.tried) blockers.push("Someone needs to try the preview and approve it.");
    if (gate === "owner-approval" && !input.approvals.some((a) => a.role === "owner")) {
      blockers.push("This touches money, data, auth or security, so the Owner must approve.");
    }
    if (gate === "data-preview" && !input.dataPreviewed) blockers.push("Review the before/after rows first.");
  }
  return { canShip: blockers.length === 0, blockers };
}

/** Who may approve a change: the role must hold change.approve, and owner-gated risk needs the Owner. */
export function canApprove(role: Role, risk: RiskClass[]): boolean {
  if (!canSite(role, "change.approve")) return false;
  return risk.some((r) => OWNER_GATED.includes(r)) ? role === "owner" : true;
}
