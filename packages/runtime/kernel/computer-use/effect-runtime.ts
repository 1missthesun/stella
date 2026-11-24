import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

export const computerUseRuntime = ManagedRuntime.make(Layer.empty);

export const runComputerUseEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await computerUseRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const sleepMs = (ms: number): Promise<void> =>
  computerUseRuntime.runPromise(Effect.sleep(ms));

export const forkCancelableTimeout = (
  timeoutMs: number,
  onTimeout: () => void,
): (() => void) => {
  const canceled = Deferred.makeUnsafe<void>();
  void computerUseRuntime
    .runPromise(
      Effect.raceFirst(
        Effect.sleep(timeoutMs).pipe(
          Effect.flatMap(() => Effect.sync(onTimeout)),
        ),
        Deferred.await(canceled),
      ),
    )
    .catch(() => undefined);
  return () => {
    Deferred.doneUnsafe(canceled, Effect.void);
  };
};
