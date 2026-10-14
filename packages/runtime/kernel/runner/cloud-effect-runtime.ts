import { Cause, Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect";

export const cloudWritersRuntime = ManagedRuntime.make(Layer.empty);

export const runCloudWriterEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await cloudWritersRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const forkDelayedCall = (
  delayMs: number,
  fire: () => void,
): (() => void) => {
  const canceled = Deferred.makeUnsafe<void>();
  void cloudWritersRuntime
    .runPromise(
      Effect.raceFirst(
        Effect.sleep(delayMs).pipe(Effect.flatMap(() => Effect.sync(fire))),
        Deferred.await(canceled),
      ),
    )
    .catch(() => undefined);
  return () => {
    Deferred.doneUnsafe(canceled, Effect.void);
  };
};

export const raceWithTimeoutError = <A>(
  promise: Promise<A>,
  timeoutMs: number,
  makeTimeoutError: () => Error,
): Promise<A> =>
  runCloudWriterEffect(
    Effect.raceFirst(
      Effect.tryPromise({ try: () => promise, catch: (error) => error }),
      Effect.sleep(timeoutMs).pipe(
        Effect.flatMap(() => Effect.fail(makeTimeoutError())),
      ),
    ),
  );
