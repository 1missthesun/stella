import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export const acquireAbortLatch = (
	signal: AbortSignal | undefined,
): Effect.Effect<Deferred.Deferred<unknown>, never, Scope.Scope> =>
	Effect.gen(function* () {
		const latch = yield* Deferred.make<unknown>();
		if (!signal) {
			return latch;
		}
		if (signal.aborted) {
			yield* Deferred.succeed(latch, signal.reason);
			return latch;
		}
		const onAbort = () => {
			Deferred.doneUnsafe(latch, Effect.succeed(signal.reason));
		};
		yield* Effect.acquireRelease(
			Effect.sync(() => signal.addEventListener("abort", onAbort)),
			() => Effect.sync(() => signal.removeEventListener("abort", onAbort)),
		);
		return latch;
	});
