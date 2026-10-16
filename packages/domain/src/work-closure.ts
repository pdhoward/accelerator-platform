import type { WorkItem } from "./flywheel";

export const WORK_TERMINAL_LABEL = {
  done: "Closed",
  cancelled: "Closed without platform release",
} as const;

export const WORK_CLOSURE_LABEL = {
  cancel: "Close without platform release",
  close: "Close completed work",
} as const;
/** Closing a tracking item is distinct from deploying, reverting or deleting its artifacts. */
export function workClosureCopy(work: Pick<WorkItem, "number" | "released">) {
  const action = work.released ? "close" : "cancel";
  return {
    action,
    label: WORK_CLOSURE_LABEL[action],
    confirmation: work.released
      ? `Close Work #${work.number}? Its recorded release evidence, code and history remain. You can start another improvement independently.`
      : `Close Work #${work.number} without a recorded platform release? Designs, completed steps, branches and previews remain. This does not deploy or undo code, and does not claim a verified release. Changes delivered outside the platform remain as they are. You can start another improvement independently.`,
    receipt: work.released
      ? `closed #${work.number}. Recorded release evidence remains available.`
      : `closed #${work.number} without a recorded platform release. Existing code, branches, previews and history were retained; this action did not deploy or undo changes.`,
    success: `Work #${work.number} closed. Its history is preserved; you can start another improvement.`,
  } as const;
}
