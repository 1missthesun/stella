export type CloudSocketStatus =
  | "idle"
  | "connecting"
  | "live"
  | "offline"
  | "blocked";

export const CLOUD_OFFLINE_NOTICE_DELAY_MS = 5_000;

export type CloudOfflineWindow = {
  since: number | null;
};

export const idleCloudOfflineWindow: CloudOfflineWindow = { since: null };

export function nextCloudOfflineWindow(
  window: CloudOfflineWindow,
  status: CloudSocketStatus,
  nowMs: number,
): CloudOfflineWindow {
  if (status === "offline") {
    return window.since === null ? { since: nowMs } : window;
  }
  if (status === "connecting") return window;
  return window.since === null ? window : idleCloudOfflineWindow;
}

export function shouldShowCloudOfflineNotice(
  window: CloudOfflineWindow,
  status: CloudSocketStatus,
  nowMs: number,
  delayMs: number = CLOUD_OFFLINE_NOTICE_DELAY_MS,
): boolean {
  return (
    status === "offline" &&
    window.since !== null &&
    nowMs - window.since >= delayMs
  );
}

export function cloudOfflineNoticeDueAt(
  window: CloudOfflineWindow,
  status: CloudSocketStatus,
  delayMs: number = CLOUD_OFFLINE_NOTICE_DELAY_MS,
): number | null {
  return status === "offline" && window.since !== null
    ? window.since + delayMs
    : null;
}
