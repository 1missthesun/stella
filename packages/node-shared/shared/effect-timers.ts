import { Effect, Fiber } from "effect";

export const sleep = (ms: number): Promise<void> =>
  Effect.runPromise(Effect.sleep(ms));

export const forkDelayed = (delayMs: number, fire: () => void): (() => void) => {
  const fiber = Effect.runFork(
    Effect.sleep(delayMs).pipe(Effect.andThen(Effect.sync(fire))),
  );
  return () => {
    void Effect.runFork(Fiber.interrupt(fiber));
  };
};

export const nullAfter = <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> =>
  Effect.runPromise(
    Effect.raceFirst(
      Effect.tryPromise(() => promise),
      Effect.sleep(timeoutMs).pipe(Effect.as(null)),
    ),
  );

export const withTimeout = <T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> =>
  Effect.runPromise(
    Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
      Effect.timeout(timeoutMs),
    ),
  );
