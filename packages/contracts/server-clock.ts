const TOLERATED_SKEW_MS = 30_000;

let offsetMs = 0;
const listeners = new Set<() => void>();

export const noteServerTime = (serverTimeMs: number): void => {
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
  const skew = serverTimeMs - Date.now();
  const next = Math.abs(skew) < TOLERATED_SKEW_MS ? 0 : skew;
  const moved = Math.abs(next - offsetMs) >= TOLERATED_SKEW_MS;
  offsetMs = next;
  if (moved) for (const listener of listeners) listener();
};

export const noteServerDate = (response: Response): void => {
  noteServerTime(Date.parse(response.headers.get("date") ?? ""));
};

export const onServerClockMove = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const serverNow = (): number => Date.now() + offsetMs;

export const toServerTime = (deviceTimeMs: number): number => deviceTimeMs + offsetMs;

export const toDeviceTime = (serverTimeMs: number): number => serverTimeMs - offsetMs;
