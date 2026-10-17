import type { Complexity } from "./complexity";
import { OWNER_GATED } from "./gates";
import type { RiskClass } from "./types";

/**
 * Decisions in the conversation (gen2-crew.md §17.4, D43). The one decision a
 * person must take now becomes a card in the thread; it can be answered with
 * its button or by typing "approve" / "ship it". A typed answer is a typed
 * server action: it resolves only the decision the person was shown (its key
 * binds the exact document version or candidate), never an Owner-gated one,
 * and never on enthusiasm alone.
 */

export type DecisionKind = "approve_brief" | "approve_design" | "approve_plan" | "approve_try" | "ship" | "release" | "close";

export type PendingDecision = {
  kind: DecisionKind;
  /** Binds the decision to what was shown: kind plus document version or candidate commit. */
  key: string;
  /** The card's title, e.g. "Approve the Brief (v2)". */
  title: string;
  /** The button label. */
  action: string;
  /** Money, data, auth or security: only the button (plus a confirm), never a typed answer. */
  ownerOnly: boolean;
  /** The site permission the decider needs beyond change.approve. */
  needsRelease: boolean;
};

/** What a decision needs to know about the item; plain data so the console and API agree. */
export type DecisionFacts = {
  complexity: Complexity;
  risk: RiskClass[];
  latestDesignVersion: number | null;
  candidate: string | null; // the proven commit
  actions: { approveDesign: boolean; approvePlan: boolean; approveTry: boolean; ship: boolean; release: boolean; close: boolean };
};

const short = (sha: string | null) => (sha ? sha.slice(0, 8) : "the preview");

/** The single governance decision pending now, if any, in the order the rail reaches them. */
export function pendingDecision(f: DecisionFacts): PendingDecision | null {
  const ownerOnly = f.risk.some((r) => OWNER_GATED.includes(r));
  const a = f.actions;
  const make = (kind: DecisionKind, target: string, title: string, action: string, needsRelease = false): PendingDecision => ({
    kind, key: `${kind}:${target}`, title, action, ownerOnly: ownerOnly && kind !== "close", needsRelease,
  });
  if (a.approveDesign && f.latestDesignVersion != null) {
    const v = f.latestDesignVersion;
    return f.complexity === "medium" ? make("approve_brief", `v${v}`, `Approve the Brief (v${v})`, "Approve the Brief") : make("approve_design", `v${v}`, `Approve design v${v}`, "Approve design");
  }
  if (a.approvePlan) return make("approve_plan", `v${f.latestDesignVersion ?? 0}`, "Approve the plan", "Approve plan");
  if (a.ship) return make("ship", f.candidate ?? "none", `Ship it (${short(f.candidate)})`, "Ship it", true);
  if (a.approveTry) return make("approve_try", f.candidate ?? "none", `Approve the preview for release (${short(f.candidate)})`, "Approve for release");
  if (a.release) return make("release", f.candidate ?? "none", `Go live (${short(f.candidate)})`, "Go live", true);
  if (a.close) return make("close", "live", "Close this item", "Close");
  return null;
}

export type Intent = "approve" | "pause" | "resume";

const APPROVE = new Set([
  "approve", "approved", "i approve", "approve it", "approve this", "approve that",
  "approve the brief", "approve brief", "approve the design", "approve design", "approve the plan", "approve plan",
  "ship it", "ship", "yes ship it", "ok ship it", "ship it please", "please ship it", "go live", "release it", "release",
  "approve and ship", "approved ship it", "lgtm ship it", "looks good ship it", "close it", "close",
]);
const PAUSE = new Set(["stop", "pause", "wait", "hold", "hold on", "stop the crew", "pause the crew", "stop please", "please stop", "pause please"]);
const RESUME = new Set(["resume", "continue", "carry on", "go on", "unpause", "keep going", "resume the crew"]);

/**
 * A short message that is exactly an approval, a pause or a resume. Anything
 * longer or less exact is conversation, for the lead: "yes" alone is never an
 * approval, because it may answer the lead's question.
 */
export function readIntent(text: string): Intent | null {
  const t = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 5) return null;
  if (PAUSE.has(t)) return "pause";
  if (RESUME.has(t)) return "resume";
  if (APPROVE.has(t)) return "approve";
  return null;
}

// ── The crew's own repairs (§17.4, §14.3: bounded recovery) ──────────────────
/** Automatic re-runs of a blocked step before it comes to a person. */
export const MAX_STEP_REPAIRS = 2;
/** Automatic fix-and-prove-again rounds after a failed Prove. */
export const MAX_PROOF_REPAIRS = 1;
