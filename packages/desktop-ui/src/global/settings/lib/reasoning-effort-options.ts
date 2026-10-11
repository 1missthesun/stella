/**
 * Reasoning-effort choices shared by the sidebar model picker and the
 * composer's pinned mini picker, so both surfaces present the same ladder.
 */
import type { ReasoningEffortLevel } from "@stella/contracts/reasoning-effort";

export type ReasoningEffortOptionId = ReasoningEffortLevel;

export type ReasoningEffortOption = {
  id: ReasoningEffortOptionId;
  /**
   * English label kept for surfaces that have not moved onto `useT()` yet.
   * Prefer `labelKey` with the i18n catalog for anything user-visible.
   */
  label: string;
  /** Catalog key for the localized label. */
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

/** Every engine and model shows the same ladder; each maps it to its own levels. */
export function listReasoningEffortOptions(): readonly ReasoningEffortOption[] {
  return REASONING_EFFORT_OPTIONS;
}

/**
 * Whether the user may choose a reasoning effort for the current selection:
 * any selected model, Stella's own included, plus the Codex / Claude Code
 * engines.
 */
export function supportsReasoningEffortSelection(
  engine: string,
  selectedModelId: string | null | undefined,
): boolean {
  if (engine === "codex_cli" || engine === "claude_code_local") return true;
  return (selectedModelId?.trim() ?? "").length > 0;
}
