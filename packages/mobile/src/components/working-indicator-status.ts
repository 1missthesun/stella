import {
  computeStatus,
  normalizeDisplayStatusText,
} from "@stella/contracts/working-status";

export {
  computeStillStatus,
  getWorkingIndicatorThinkingText,
  normalizeDisplayStatusText,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
  WORKING_INDICATOR_THINKING_LABEL_MS,
} from "@stella/contracts/working-status";

/**
 * The label beside the mark, or `""` when there is nothing worth saying.
 * The words come from the table desktop uses, seeded the same way, so a tool
 * call reads the same on the phone as on the computer running it. Plain
 * thinking returns empty; the indicator adds its timed thinking label.
 */
export function computeWorkingIndicatorStatus({
  status,
  toolName,
  seed,
}: {
  status?: string;
  toolName?: string;
  seed?: string;
} = {}): string {
  if (status) return normalizeDisplayStatusText(status) ?? status;
  return computeStatus({ toolName, seed });
}
