import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
export { forkTimeoutFiber, sleepMs } from "./timers.js";

export const connectorsRuntime = ManagedRuntime.make(Layer.empty);

export const runConnectorEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await connectorsRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const tryConnectorOp = <A>(
  op: () => Promise<A>,
): Effect.Effect<A, unknown> =>
  Effect.tryPromise({
    try: op,
    catch: (error) => error,
  });

export const guardWithAbortTimeout = <A>(args: {
  timeoutMs: number;
  onTimeout: () => void;
  run: () => Promise<A>;
  mapError?: (error: unknown) => unknown;
}): Promise<A> =>
  runConnectorEffect(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          Effect.sleep(args.timeoutMs).pipe(
            Effect.flatMap(() => Effect.sync(args.onTimeout)),
          ),
          { startImmediately: true },
        );
        return yield* Effect.tryPromise({
          try: args.run,
          catch: (error) => (args.mapError ? args.mapError(error) : error),
        });
      }),
    ),
  );
