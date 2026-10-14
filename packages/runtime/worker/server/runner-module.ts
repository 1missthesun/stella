import { Cause, Context, Deferred, Effect, Exit, Layer } from "effect";

export type RunnerModuleExports = typeof import("../../kernel/runner.js");

export interface Interface {
  readonly prefetch: Effect.Effect<void>;
  readonly load: () => Promise<RunnerModuleExports>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/worker/RunnerModule",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const loaded = yield* Deferred.make<RunnerModuleExports, unknown>();
    let started = false;

    const prefetch = Effect.suspend(() => {
      if (started) return Effect.void;
      started = true;
      return Effect.tryPromise({
        try: () => import("../../kernel/runner.js"),
        catch: (error) => error,
      }).pipe(
        Deferred.into(loaded),
        Effect.forkIn(scope, { startImmediately: true }),
        Effect.asVoid,
      );
    });

    const load = async (): Promise<RunnerModuleExports> => {
      const exit = await Effect.runPromiseExit(
        Effect.andThen(prefetch, Deferred.await(loaded)),
      );
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    };

    return { prefetch, load };
  }),
);
