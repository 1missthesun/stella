import type { ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";

export type ReasoningEffortOptionId = ReasoningEffortLevel;

export type ReasoningEffortOption = {
  id: ReasoningEffortOptionId;
  /**
   * English label kept for surfaces that have not moved onto `useT()` yet.
   * Prefer `labelKey` with the i18n catalog for anything user-visible.
   */
  label: string;
  labelKey: string;
};

export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffortOption[] = [
  { id: "low", label: "Low", labelKey: "settings.reasoningEffort.low" },
  {
    id: "medium",
    label: "Medium",
    labelKey: "settings.reasoningEffort.medium",
  },
  { id: "high", label: "High", labelKey: "settings.reasoningEffort.high" },
  { id: "xhigh", label: "XHigh", labelKey: "settings.reasoningEffort.xhigh" },
  { id: "max", label: "Max", labelKey: "settings.reasoningEffort.max" },
];

export function listReasoningEffortOptions(): readonly ReasoningEffortOption[] {
  return REASONING_EFFORT_OPTIONS;
}

