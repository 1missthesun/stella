const TOLERATED_SKEW_MS = 30_000;

let offsetMs = 0;

export const noteServerTime = (serverTimeMs: number): void => {
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
  const skew = serverTimeMs - Date.now();
  offsetMs = Math.abs(skew) < TOLERATED_SKEW_MS ? 0 : skew;
};

export const serverNow = (): number => Date.now() + offsetMs;

export const toServerTime = (deviceTimeMs: number): number => deviceTimeMs + offsetMs;

export const toDeviceTime = (serverTimeMs: number): number => serverTimeMs - offsetMs;
