import type { ProcessRuntime } from "./process-runtime.js";

export type ManagedResource<TPublic extends Record<string, unknown> = Record<string, never>> = {
  start: () => void;
  stop: () => Promise<void>;
} & TPublic;

export type ManagedResourceConfig<TService> = {
  processRuntime: ProcessRuntime;
  canStart?: () => boolean;
  create: (hooks: { onUnexpectedExit: (error: string) => void }) => TService;
  setup?: (service: TService) => void;
  start: (service: TService) => Promise<void>;
  stop: (service: TService) => Promise<void>;
  onAttempt?: (info: { attempt: number }) => void;
  onStarted?: () => void;
  onRetry?: (info: { attempt: number; delayMs: number; error: string }) => void;
  onError?: (error: string) => void;
  retry?: { baseDelayMs?: number; maxDelayMs?: number; fixedDelayMs?: number };
  oneShot?: boolean;
};

/**
 * One service instance lives from `start()` to `stop()`. Launch failures and
 * unexpected exits re-run `config.start` on that same instance, so state the
 * service carries across restarts (agent backends, delegates) is never
 * orphaned in an abandoned instance.
 */
type ResourcePhase<TService> =
  | { kind: "stopped" }
  | { kind: "launching"; service: TService; launch: Promise<void> }
  | { kind: "running"; service: TService }
  | { kind: "retrying"; service: TService; cancel: () => void }
  | { kind: "completed"; service: TService };

export const createManagedResource = <
  TService,
  TPublic extends Record<string, unknown> = Record<string, never>,
>(
  config: ManagedResourceConfig<TService>,
  extraApi?: (controls: { getService: () => TService | null }) => TPublic,
): ManagedResource<TPublic> => {
  let phase: ResourcePhase<TService> = { kind: "stopped" };
  let retryAttempt = 0;

  const computeDelay = () => {
    if (config.retry?.fixedDelayMs != null) return config.retry.fixedDelayMs;
    const base = config.retry?.baseDelayMs ?? 1_000;
    const max = config.retry?.maxDelayMs ?? 30_000;
    return Math.min(base * 2 ** Math.max(0, retryAttempt - 1), max);
  };

  const scheduleRetry = (service: TService, error: string) => {
    if (config.processRuntime.isShuttingDown()) return;
    retryAttempt += 1;
    const delayMs = computeDelay();
    config.onRetry?.({ attempt: retryAttempt, delayMs, error });
    const cancel = config.processRuntime.setManagedTimeout(() => {
      if (config.processRuntime.isShuttingDown()) return;
      if (phase.kind === "retrying" && phase.service === service) {
        launch(service);
      }
    }, delayMs);
    phase = { kind: "retrying", service, cancel };
  };

  const launch = (service: TService) => {
    config.onAttempt?.({ attempt: retryAttempt });
    const attempt: Promise<void> = config.start(service).then(
      () => {
        if (phase.kind !== "launching" || phase.launch !== attempt) return;
        retryAttempt = 0;
        phase = config.oneShot
          ? { kind: "completed", service }
          : { kind: "running", service };
        config.onStarted?.();
      },
      (err: unknown) => {
        if (phase.kind !== "launching" || phase.launch !== attempt) return;
        const msg = err instanceof Error ? err.message : String(err);
        config.onError?.(msg);
        scheduleRetry(service, msg);
      },
    );
    phase = { kind: "launching", service, launch: attempt };
  };

  const create = () => {
    const service: TService = config.create({
      onUnexpectedExit: (error) => {
        if (phase.kind !== "running" || phase.service !== service) return;
        scheduleRetry(service, error);
      },
    });
    config.setup?.(service);
    return service;
  };

  const publicExtra =
    extraApi?.({
      getService: () =>
        phase.kind === "launching" ||
        phase.kind === "running" ||
        phase.kind === "completed"
          ? phase.service
          : null,
    }) ?? ({} as TPublic);

  return {
    start: () => {
      if (phase.kind !== "stopped" || config.processRuntime.isShuttingDown()) {
        return;
      }
      if (config.canStart && !config.canStart()) return;
      launch(create());
    },
    stop: async () => {
      const current = phase;
      phase = { kind: "stopped" };
      retryAttempt = 0;
      if (current.kind === "stopped") return;
      if (current.kind === "retrying") current.cancel();
      await config.stop(current.service).catch(() => undefined);
    },
    ...publicExtra,
  };
};
