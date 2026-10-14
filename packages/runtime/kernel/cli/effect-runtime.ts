import { Cause, Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { acquireAbortLatch } from "../agent-core/abort-bridge.js";

export const cliRuntime = ManagedRuntime.make(Layer.empty);

export const runCliEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await cliRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const sleepMs = (ms: number): Promise<void> =>
  cliRuntime.runPromise(Effect.sleep(ms));

export const sleepWithAbort = (
  ms: number,
  signal: AbortSignal | undefined,
  makeAbortError: (signal: AbortSignal | undefined) => Error,
): Promise<void> =>
  runCliEffect(
    Effect.scoped(
      Effect.gen(function* () {
        if (!signal) {
          return yield* Effect.sleep(ms);
        }
        if (signal.aborted) {
          return yield* Effect.fail(makeAbortError(signal));
        }
        const abortLatch = yield* acquireAbortLatch(signal);
        yield* Effect.raceFirst(
          Effect.sleep(ms),
          Deferred.await(abortLatch).pipe(
            Effect.flatMap(() => Effect.fail(makeAbortError(signal))),
          ),
        );
      }),
    ),
  );

export const forkTimeoutFiber = (
  timeoutMs: number,
  onTimeout: () => void,
): (() => void) => {
  const canceled = Deferred.makeUnsafe<void>();
  void cliRuntime
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

export const forkKeepAliveTicker = (intervalMs: number): (() => void) => {
  const stopped = Deferred.makeUnsafe<void>();
  void cliRuntime
    .runPromise(
      Effect.raceFirst(
        Effect.forever(Effect.sleep(intervalMs)),
        Deferred.await(stopped),
      ),
    )
    .catch(() => undefined);
  return () => {
    Deferred.doneUnsafe(stopped, Effect.void);
  };
};
