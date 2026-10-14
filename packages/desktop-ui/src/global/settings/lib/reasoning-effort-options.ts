import type { ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";

export type ReasoningEffortOptionId = ReasoningEffortLevel;

export type ReasoningEffortOption = {
  id: ReasoningEffortOptionId;
  labelKey: string;
};

export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffortOption[] = [
  { id: "low", labelKey: "settings.reasoningEffort.low" },
  { id: "medium", labelKey: "settings.reasoningEffort.medium" },
  { id: "high", labelKey: "settings.reasoningEffort.high" },
  { id: "xhigh", labelKey: "settings.reasoningEffort.xhigh" },
  { id: "max", labelKey: "settings.reasoningEffort.max" },
];

export function listReasoningEffortOptions(): readonly ReasoningEffortOption[] {
  return REASONING_EFFORT_OPTIONS;
}
