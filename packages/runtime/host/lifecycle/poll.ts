import { Effect, Schedule } from "effect";

export const pollWithDeadline = <A, E, ED, R>(args: {
  timeoutMs: number;
  intervalMs: number;
  attempt: Effect.Effect<A, E, R>;
  retryWhile: (error: E) => boolean;
  onDeadline: () => ED;
}): Effect.Effect<A, E | ED, R> =>
  Effect.suspend(() => {
    const deadline = Date.now() + args.timeoutMs;
    let deadlineError: ED | undefined;
    const gated = Effect.suspend((): Effect.Effect<A, E | ED, R> => {
      if (Date.now() >= deadline) {
        deadlineError = args.onDeadline();
        return Effect.fail(deadlineError);
      }
      return args.attempt;
    });
    return gated.pipe(
      Effect.retry({
        while: (error) =>
          error !== deadlineError && args.retryWhile(error as E),
        schedule: Schedule.spaced(args.intervalMs),
      }),
    );
  });
