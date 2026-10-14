import {
  Cause,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  type Scope,
} from "effect";

export const discoveryRuntime = ManagedRuntime.make(Layer.empty);

export const runDiscovery = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await discoveryRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const tryDiscovery = <A>(
  op: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: (signal) => op(signal), catch: (error) => error });

export const tryDiscoverySync = <A>(op: () => A): Effect.Effect<A, unknown> =>
  Effect.try({ try: op, catch: (error) => error });

/** On timeout the collector is interrupted, aborting the signal its leaves received. */
export const timeoutFallback = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  ms: number,
  fallback: A,
): Effect.Effect<A, E, R> =>
  Effect.timeoutOrElse(effect, {
    duration: ms,
    orElse: () => Effect.succeed(fallback),
  });

export const acquireCloseable = <Db extends { close: () => void }>(
  open: () => Promise<Db>,
): Effect.Effect<Db, unknown, Scope.Scope> =>
  Effect.acquireRelease(tryDiscovery(open), (db) =>
    Effect.sync(() => db.close()),
  );
