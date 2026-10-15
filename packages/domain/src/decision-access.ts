import { canApprove } from "./gates";
import { canSite } from "./permissions";
import type { AccessVia, RiskClass, Role } from "./types";

/** Explain an unavailable decision using the same role/risk rules as the API. Never grants authority. */
export function decisionAccessReason(input: {
  via: AccessVia;
  role: Role;
  risk: RiskClass[];
  gate: "design" | "plan" | "try" | "release" | "execute";
}): string | null {
  if (input.via !== "member")
    return "Only a direct client account member with the appropriate role can approve or advance this work. Your current access is partner/support access; platform admin status does not grant client approval authority. Ask the account Owner to review, or use an identity that is already a direct member of this account.";
  if (!canSite(input.role, "change.approve"))
    return "Your client account role cannot approve or advance this work. Ask the account Owner or an authorized account member to review. You can continue inspecting the design and evidence.";
  if (input.gate === "try" && !canApprove(input.role, input.risk))
    return "This change touches money, data, authentication or security. The client account Owner must approve the preview before release; your current account role cannot make that decision.";
  if (input.gate === "release" && !canSite(input.role, "release.ship"))
    return "Your client account role cannot release to production. Ask the account Owner or an authorized Operator to review the release evidence and go live.";
  return null;
}
