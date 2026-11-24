import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schedule from "effect/Schedule";

export const hostRuntime = ManagedRuntime.make(Layer.empty);

export const runHostEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await hostRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const sleepMs = (ms: number): Promise<void> =>
  hostRuntime.runPromise(Effect.sleep(ms));

export type HostTimerHandle = {
  readonly cancel: () => void;
};

export const forkDelayed = (
  delayMs: number,
  fire: () => void,
): HostTimerHandle => {
  const canceled = Deferred.makeUnsafe<void>();
  void hostRuntime
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

export const forkInterval = (
  intervalMs: number,
  fire: () => void,
): HostTimerHandle => {
  const canceled = Deferred.makeUnsafe<void>();
  void hostRuntime
    .runPromise(
      Effect.raceFirst(
        Effect.sleep(intervalMs).pipe(
          Effect.andThen(
            Effect.repeat(Effect.sync(fire), Schedule.fixed(intervalMs)),
          ),
        ),
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
