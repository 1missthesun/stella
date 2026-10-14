import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

export type NativeTurnCancellation = {
  readonly aborted: boolean;
  readonly reason: Error | undefined;
  abort(reason: Error): void;
  readonly awaitAborted: Effect.Effect<never, Error>;
};

export const createNativeTurnCancellation = (): NativeTurnCancellation => {
  const canceled = Deferred.makeUnsafe<void>();
  let abortReason: Error | undefined;
  return {
    get aborted() {
      return abortReason !== undefined;
    },
    get reason() {
      return abortReason;
    },
    abort: (reason: Error) => {
      if (abortReason) return;
      abortReason = reason;
      Deferred.doneUnsafe(canceled, Effect.void);
    },
    awaitAborted: Deferred.await(canceled).pipe(
      Effect.flatMap(() =>
        Effect.fail(abortReason ?? new Error("Claude Code turn was canceled.")),
      ),
    ),
  };
};
