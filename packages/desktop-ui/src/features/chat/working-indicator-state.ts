import type { TaskItem } from "@/features/chat/lib/event-transforms";
import { isStandaloneTaskStatusText } from "@/features/chat/lib/event-transforms";
import {
  computeStatus,
  normalizeDisplayStatusText,
} from "@stella/contracts/working-status";

export {
  getWorkingIndicatorThinkingText,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
  WORKING_INDICATOR_THINKING_LABEL_MS,
} from "@stella/contracts/working-status";

export const INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS = 2000;

export const INLINE_WORKING_INDICATOR_SHOW_DELAY_MS = 300;

export const WORKING_INDICATOR_HANDOFF_MS = 240;

export const WORKING_INDICATOR_COMPACTING_TEXT = "Compacting";

export type InlineWorkingIndicatorProps = {
  runningTool?: string;
  compacting?: boolean;
  runningToolId?: string;
  status?: string | null;
  minimumVisibleMs?: number;
};

export type InlineWorkingIndicatorMountProps = InlineWorkingIndicatorProps & {
  active: boolean;
  exitImmediately?: boolean;
  handoff?: boolean;
};

export function buildInlineWorkingIndicatorProps({
  isStreaming,
  isToolActive,
  answerLanded,
  activeToolName,
  activeToolCallId,
  runtimeStatusText,
  isCompacting,
}: {
  isStreaming: boolean;
  isToolActive: boolean;
  answerLanded?: boolean;
  activeToolName?: string | null;
  activeToolCallId?: string | null;
  runtimeStatusText?: string | null;
  isCompacting?: boolean;
}): InlineWorkingIndicatorMountProps {
  const handoff = Boolean(answerLanded) && !isToolActive;
  const active = getInlineWorkingIndicatorActive({
    isStreaming,
    isToolActive,
    answerLanded: handoff,
  });
  const isThinking = isStreaming && !isToolActive;
  return {
    active,
    ...(!isStreaming && !handoff ? { exitImmediately: true } : {}),
    ...(handoff ? { handoff: true } : {}),
    runningTool: isToolActive ? (activeToolName ?? undefined) : undefined,
    runningToolId: isToolActive ? (activeToolCallId ?? undefined) : undefined,
    status: isThinking ? (runtimeStatusText ?? null) : null,
    ...(isThinking && isCompacting ? { compacting: true } : {}),
  };
}

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
  if (/shell|command/.test(tool)) return "working";
  return "working";
}

export function getRunningTaskIndicatorText(
  task: TaskItem,
): string | undefined {
  if (task.status !== "running") return undefined;
  const statusText = normalizeDisplayStatusText(task.statusText);
  if (!statusText) return undefined;
  if (statusText === task.description.trim()) return undefined;
  return statusText;
}

export function getInlineWorkingIndicatorActive({
  isStreaming,
  isToolActive,
  answerLanded,
}: {
  isStreaming: boolean;
  isToolActive: boolean;
  answerLanded?: boolean;
}): boolean {
  return (isStreaming && !answerLanded) || isToolActive;
}

export function getInlineWorkingIndicatorExitDelayMs({
  activatedAtMs,
  nowMs,
  minVisibleMs = INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
}: {
  activatedAtMs: number;
  nowMs: number;
  minVisibleMs?: number;
}): number {
  return Math.max(0, minVisibleMs - (nowMs - activatedAtMs));
}

export function getWorkingIndicatorDisplayStatus({
  status,
  toolName,
  toolCallId,
  tasks,
}: {
  status?: string;
  toolName?: string;
  toolCallId?: string;
  tasks?: TaskItem[];
}): string {
  if (status) {
    return normalizeDisplayStatusText(status) ?? status;
  }

  if (tasks && tasks.length > 0) {
    const task = tasks[0];
    if (task.status === "completed") {
      const taskText = normalizeDisplayStatusText(task.statusText);
      return taskText ? `Done · ${taskText}` : "Done";
    }
    if (task.status === "running") {
      const statusText = getRunningTaskIndicatorText(task);
      if (statusText && !isStandaloneTaskStatusText(statusText)) {
        return statusText;
      }
      if (statusText && isStandaloneTaskStatusText(statusText)) {
        return statusText;
      }
      if (toolName) {
        return computeStatus({ toolName, seed: toolCallId });
      }
      return computeStatus({ toolName: "spawn_agent", seed: "" });
    }
  }

  return computeStatus({ toolName, seed: toolCallId });
}
