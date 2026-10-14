import {
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
} from "effect";

export const workerRuntime = ManagedRuntime.make(Layer.empty);

export type WorkerTimerHandle = {
  readonly cancel: () => void;
};

export const forkDelayed = (
  delayMs: number,
  fire: () => void,
): WorkerTimerHandle => {
  const canceled = Deferred.makeUnsafe<void>();
  void workerRuntime
    .runPromise(
      Effect.raceFirst(
        Effect.sleep(delayMs).pipe(Effect.andThen(Effect.sync(fire))),
        Deferred.await(canceled),
      ),
    )
    .catch(() => undefined);
  return {
    cancel: () => {
      Deferred.doneUnsafe(canceled, Effect.void);
    },
  };
};
