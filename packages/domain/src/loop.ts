import type { LoopStage } from "./types";

/** The loop, in order. The human owns commit (priority), try and ship. */
export const LOOP: readonly LoopStage[] = ["clarify", "build", "prove", "try", "ship", "watch", "done"];

export const STAGE_LABEL: Record<LoopStage | "new", string> = {
  new: "New",
  clarify: "Clarify",
  build: "Build",
  prove: "Prove",
  try: "Try",
  ship: "Ship",
  watch: "Watch",
  done: "Done",
};

/** Stages where the next move belongs to a person, not the engine. */
export const HUMAN_STAGES: readonly LoopStage[] = ["try", "ship"];

/** Forward one step, or back to build ("send back"). No skipping, no other jumps. */
export function nextStage(stage: LoopStage): LoopStage {
  const i = LOOP.indexOf(stage);
  return LOOP[Math.min(i + 1, LOOP.length - 1)] ?? "done";
}

export function canMove(from: LoopStage, to: LoopStage): boolean {
  if (to === "build" && (from === "prove" || from === "try")) return true; // send back
  return nextStage(from) === to;
}
