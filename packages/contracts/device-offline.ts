export const DEVICE_OFFLINE_REASON = "device_offline";

export const DEVICE_OFFLINE_RETRY_MS = 8_000;
export const DEVICE_OFFLINE_POLL_MS = 2_000;

const age = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
};

export const deviceLastSeenText = (lastSeenAt: number | undefined, now = Date.now()): string =>
  lastSeenAt === undefined
    ? ""
    : `, last seen ${new Date(lastSeenAt).toISOString().slice(0, 16).replace("T", " ")} UTC (${age(now - lastSeenAt)})`;

export const deviceOfflineText = (
  device: { name: string; deviceId: string; lastSeenAt?: number },
  outcome: string,
  now = Date.now(),
): string =>
  `${device.name} (device_id ${device.deviceId}) is offline${deviceLastSeenText(device.lastSeenAt, now)}. ${outcome}`;

export const isDeviceOfflineError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { reason?: unknown }).reason === DEVICE_OFFLINE_REASON;
