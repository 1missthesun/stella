import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";

export const extensionsRuntime = ManagedRuntime.make(Layer.empty);

export const runExtensionEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await extensionsRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const tryExtensionOp = <A>(
  op: () => Promise<A>,
): Effect.Effect<A, unknown> =>
  Effect.tryPromise({
    try: op,
    catch: (error) => error,
  });
