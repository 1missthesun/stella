import {
  ANONYMOUS_COUNTS_ENABLED,
  type AnonymousCountRequest,
} from "@stella/contracts/telemetry/anonymous-counts";

export const recordAnonymousCount = (request: AnonymousCountRequest): void => {
  if (!ANONYMOUS_COUNTS_ENABLED) return;
  void window.electronAPI?.system
    ?.recordAnonymousCount?.(request)
    .catch(() => undefined);
};
