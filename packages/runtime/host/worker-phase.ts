import type { PendingWorkerRestartRecord } from "./staleness.js";

export type RestartIntent = {
  readonly requested: boolean;
  readonly stale: PendingWorkerRestartRecord | null;
};

export type WorkerPhase =
  | { readonly kind: "current" }
  | { readonly kind: "wanted"; readonly intent: RestartIntent; readonly checking: boolean }
  | {
      readonly kind: "restarting";
      readonly intent: RestartIntent;
      readonly again: RestartIntent | null;
    };

export type WorkerPhaseEvent =
  | { readonly type: "requested" }
  | { readonly type: "stale"; readonly record: PendingWorkerRestartRecord }
  | { readonly type: "stale_cleared" }
  | { readonly type: "check_started" }
  | { readonly type: "check_finished" }
  | { readonly type: "restart_started" }
  | { readonly type: "restart_deferred" }
  | { readonly type: "restart_finished" }
  | { readonly type: "host_stopped" };

export const WORKER_CURRENT: WorkerPhase = { kind: "current" };

const mergeIntent = (
  base: RestartIntent | null,
  next: RestartIntent,
): RestartIntent => ({
  requested: (base?.requested ?? false) || next.requested,
  stale: base?.stale ?? next.stale,
});

const wanted = (intent: RestartIntent | null): WorkerPhase =>
  intent && (intent.requested || intent.stale)
    ? { kind: "wanted", intent, checking: false }
    : WORKER_CURRENT;

const addIntent = (phase: WorkerPhase, next: RestartIntent): WorkerPhase => {
  switch (phase.kind) {
    case "current":
      return wanted(next);
    case "wanted":
      return { ...phase, intent: mergeIntent(phase.intent, next) };
    case "restarting":
      return { ...phase, again: mergeIntent(phase.again, next) };
  }
};

const withoutStale = (intent: RestartIntent | null): RestartIntent | null =>
  intent ? { ...intent, stale: null } : null;

/** The single place the worker's restart intent changes. */
export const transitionWorkerPhase = (
  phase: WorkerPhase,
  event: WorkerPhaseEvent,
): WorkerPhase => {
  switch (event.type) {
    case "requested":
      return addIntent(phase, { requested: true, stale: null });
    case "stale":
      return addIntent(phase, { requested: false, stale: event.record });
    case "stale_cleared":
      if (phase.kind === "wanted") return wanted(withoutStale(phase.intent));
      if (phase.kind === "restarting") {
        return { ...phase, again: withoutStale(phase.again) };
      }
      return phase;
    case "check_started":
      return phase.kind === "wanted" && !phase.checking
        ? { ...phase, checking: true }
        : phase;
    case "check_finished":
      return phase.kind === "wanted" ? { ...phase, checking: false } : phase;
    case "restart_started":
      return phase.kind === "wanted"
        ? { kind: "restarting", intent: phase.intent, again: null }
        : phase;
    case "restart_deferred":
      return phase.kind === "restarting"
        ? wanted(
            phase.again ? mergeIntent(phase.intent, phase.again) : phase.intent,
          )
        : phase;
    case "restart_finished":
      return phase.kind === "restarting" ? wanted(phase.again) : phase;
    case "host_stopped":
      return WORKER_CURRENT;
  }
};

export const restartReason = (intent: RestartIntent): string =>
  intent.stale?.reason ?? "runtime-reload";

export const staleRecordOf = (
  phase: WorkerPhase,
): PendingWorkerRestartRecord | null => {
  if (phase.kind === "wanted") return phase.intent.stale;
  if (phase.kind === "restarting") return phase.again?.stale ?? phase.intent.stale;
  return null;
};
