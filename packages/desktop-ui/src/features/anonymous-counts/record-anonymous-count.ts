import {
  ANONYMOUS_COUNTS_ENABLED,
  type AnonymousCountRequest,
} from "@stella/contracts/telemetry/anonymous-counts";

/** Fire-and-forget; the main process checks the switch, the setting and self-hosting again. */
export const recordAnonymousCount = (request: AnonymousCountRequest): void => {
  if (!ANONYMOUS_COUNTS_ENABLED) return;
  void window.electronAPI?.system
    ?.recordAnonymousCount?.(request)
    .catch(() => undefined);
};
