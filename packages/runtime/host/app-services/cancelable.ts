import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import { hostRuntime } from "../effect-runtime.js";

type Running = { cancel: (reason: Error) => void };

export const createCancelableRegistry = () => {
  const running = new Map<string, Running>();

  const run = async <A>(id: string, work: (signal: AbortSignal) => Promise<A>): Promise<A> => {
    running.get(id)?.cancel(new Error("Started again."));
    let canceledWith: Error | null = null;
    const fiber = hostRuntime.runFork(
      Effect.tryPromise({ try: (signal) => work(signal), catch: (error) => error }),
    );
    const entry: Running = {
      cancel: (reason) => {
        canceledWith ??= reason;
        hostRuntime.runFork(Fiber.interrupt(fiber));
      },
    };
    running.set(id, entry);
    try {
      const exit = await hostRuntime.runPromise(Fiber.await(fiber));
      if (Exit.isSuccess(exit)) return exit.value;
      if (canceledWith) throw canceledWith;
      throw Cause.squash(exit.cause);
    } finally {
      if (running.get(id) === entry) running.delete(id);
    }
  };

  const cancel = (id: string, reason: Error): boolean => {
    const entry = running.get(id);
    if (!entry) return false;
    running.delete(id);
    entry.cancel(reason);
    return true;
  };

  return { run, cancel };
};

export const sleepUnlessAborted = (ms: number, signal?: AbortSignal): Promise<void> =>
  hostRuntime.runPromise(
    Effect.raceFirst(
      Effect.sleep(ms),
      Effect.callback<void>((resume) => {
        if (!signal) return;
        const done = () => resume(Effect.void);
        if (signal.aborted) return done();
        signal.addEventListener("abort", done, { once: true });
        return Effect.sync(() => signal.removeEventListener("abort", done));
      }),
    ),
  );
