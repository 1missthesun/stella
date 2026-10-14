import {
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
  Schedule,
} from "effect";

export const storageRuntime = ManagedRuntime.make(Layer.empty);

export const forkFixedRateFiber = (
  intervalMs: number,
  tick: () => void,
): (() => void) => {
  const canceled = Deferred.makeUnsafe<void>();
  void storageRuntime
    .runPromise(
      Effect.raceFirst(
        Effect.sleep(intervalMs).pipe(
          Effect.andThen(
            Effect.repeat(Effect.sync(tick), Schedule.fixed(intervalMs)),
          ),
          Effect.asVoid,
        ),
        Deferred.await(canceled),
      ),
    )
    .catch(() => undefined);
  return () => {
    Deferred.doneUnsafe(canceled, Effect.void);
  };
};
