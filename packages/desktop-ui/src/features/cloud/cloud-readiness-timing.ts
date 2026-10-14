export type CloudReadinessOutcome = "hit" | "miss" | "success" | "unavailable";

const reported = new Set<string>();

export const cloudReadinessNow = (): number =>
  typeof performance === "undefined" ? 0 : performance.now();

export const reportCloudReadiness = (
  phase: string,
  options: { startedAt?: number; outcome?: CloudReadinessOutcome } = {},
): void => {
  if (reported.has(phase)) return;
  const elapsedMs = cloudReadinessNow();
  const startedAt = options.startedAt;
  const durationMs =
    typeof startedAt === "number" && Number.isFinite(startedAt)
      ? Math.max(0, elapsedMs - startedAt)
      : undefined;
  if (typeof window === "undefined") return;
  const api = window.electronAPI?.system;
  if (typeof api?.reportTiming !== "function") return;
  reported.add(phase);
  api.reportTiming({
    phase,
    elapsedMs,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
  });
};
