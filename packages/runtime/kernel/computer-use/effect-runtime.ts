import { Cause, Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect";

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
