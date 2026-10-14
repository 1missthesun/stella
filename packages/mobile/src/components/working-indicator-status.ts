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
