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
  op: () => Promise<A>,
): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: op, catch: (error) => error });

export const tryDiscoverySync = <A>(op: () => A): Effect.Effect<A, unknown> =>
  Effect.try({ try: op, catch: (error) => error });

/**
 * Parity port of the collectors' `withTimeout` helper — `Promise.race`
 * against a timer that RESOLVES with `fallback`:
 *
 * - a settlement (success or failure) before `ms` wins the race;
 * - after `ms` the fallback value wins. The losing collector is interrupted,
 *   but its promise-based leaves keep running to completion in the
 *   background and clean up after themselves, exactly as the abandoned
 *   `Promise.race` loser did.
 */
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
