import { Deferred, Effect, Layer, ManagedRuntime } from "effect";

export const integrationsRuntime = ManagedRuntime.make(Layer.empty);

export const forkCancelableTimeout = (
  timeoutMs: number,
  onTimeout: () => void,
): (() => void) => {
  let canceled = false;
  const cancelLatch = Deferred.makeUnsafe<void>();
  integrationsRuntime.runFork(
    Effect.raceFirst(
      Effect.sleep(timeoutMs).pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            if (!canceled) onTimeout();
          }),
        ),
      ),
      Deferred.await(cancelLatch),
    ),
  );
  return () => {
    canceled = true;
    Deferred.doneUnsafe(cancelLatch, Effect.void);
  };
};

export const forkCancelableInterval = (
  everyMs: number,
  onTick: () => void,
): (() => void) => {
  let canceled = false;
  const cancelLatch = Deferred.makeUnsafe<void>();
  integrationsRuntime.runFork(
    Effect.raceFirst(
      Effect.forever(
        Effect.sleep(everyMs).pipe(
          Effect.flatMap(() =>
            Effect.sync(() => {
              if (!canceled) onTick();
            }),
          ),
        ),
      ),
      Deferred.await(cancelLatch),
    ),
  );
  return () => {
    canceled = true;
    Deferred.doneUnsafe(cancelLatch, Effect.void);
  };
};
