import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { acquireAbortLatch } from "../agent-core/abort-bridge.js";

export const toolsRuntime = ManagedRuntime.make(Layer.empty);

export const runToolEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await toolsRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const sleepWithAbortEffect = (
  ms: number,
  signal: AbortSignal | undefined,
  makeAbortError: (signal: AbortSignal) => Error,
): Effect.Effect<void, unknown> =>
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
  );

export const sleepWithAbort = (
  ms: number,
  signal: AbortSignal | undefined,
  makeAbortError: (signal: AbortSignal) => Error,
): Promise<void> => runToolEffect(sleepWithAbortEffect(ms, signal, makeAbortError));

export const forkAbortTimer = (
  timeoutMs: number,
  onTimeout: () => void,
): (() => void) => {
  const canceled = Deferred.makeUnsafe<void>();
  void toolsRuntime
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
