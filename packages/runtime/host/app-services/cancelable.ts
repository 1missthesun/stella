/**
 * Work the app can cancel by id (a sign-in, an install, a connector flow):
 * each runs as a fiber on the host runtime, and canceling interrupts it,
 * which aborts the signal the work was handed.
 */
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import { hostRuntime } from "../effect-runtime.js";

type Running = { cancel: (reason: Error) => void };

export const createCancelableRegistry = () => {
  const running = new Map<string, Running>();

  /**
   * Run `work` under `id`, canceling whatever already runs under it. A
   * canceled run rejects with the reason it was canceled with.
   */
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

  /** Cancel the run under `id`; false when nothing runs under it. */
  const cancel = (id: string, reason: Error): boolean => {
    const entry = running.get(id);
    if (!entry) return false;
    running.delete(id);
    entry.cancel(reason);
    return true;
  };

  return { run, cancel };
};

/** Wait `ms`, or less if `signal` aborts first. */
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
