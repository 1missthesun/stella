export type WorkingIndicatorCharacterState =
  | "thinking"
  | "working"
  | "writing"
  | "searching"
  | "reading";

export type WorkingIndicatorToolPose = Exclude<
  WorkingIndicatorCharacterState,
  "thinking"
>;

export const WORKING_INDICATOR_TOOL_POSES: readonly WorkingIndicatorToolPose[] =
  ["working", "writing", "searching", "reading"];

export const WORKING_INDICATOR_POSE_ROTATE_MS = 6000;

const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export function pickWorkingIndicatorToolPose(
  seed: string,
  avoid?: WorkingIndicatorCharacterState,
): WorkingIndicatorToolPose {
  const poses = WORKING_INDICATOR_TOOL_POSES;
  let index = hashSeed(seed) % poses.length;
  if (poses[index] === avoid) index = (index + 1) % poses.length;
  return poses[index]!;
}

export function getWorkingIndicatorCharacterState({
  toolName,
  isReasoning,
  seed,
  avoid,
}: {
  toolName?: string;
  isReasoning?: boolean;
  seed?: string;
  avoid?: WorkingIndicatorCharacterState;
}): WorkingIndicatorCharacterState {
  const tool = toolName?.trim().toLowerCase() ?? "";
  if (!tool) return isReasoning ? "thinking" : "working";
  if (seed !== undefined) return pickWorkingIndicatorToolPose(seed, avoid);
  if (/search|web/.test(tool)) return "searching";
  if (/read|fetch/.test(tool)) return "reading";
  if (/write|edit/.test(tool)) return "writing";
  return "working";
}
