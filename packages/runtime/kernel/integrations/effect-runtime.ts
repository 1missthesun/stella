/**
 * The one module-level ManagedRuntime for the external-engine integrations
 * tree (M5 kernel/integrations pass), plus the Effect combinators the
 * Claude Code runtime uses.
 *
 * House conventions (docs/effect-architecture.md, kernel/tools/shell.ts):
 * - Exactly ONE requirements-free runtime per facade module family; context
 *   rides in closures, never per-call `Effect.runPromise`.
 * - The CLI child-process kill ladders (SIGINT/SIGTERM → bounded wait →
 *   SIGKILL) are forked fibers racing the child's `exit` event (a `Deferred`
 *   exit latch) against the escalation deadline — the Effect replacement for
 *   the unref'd `setTimeout` rungs, with byte-identical signal ordering and
 *   timings.
 * - Every idle watchdog / grace timer in the integrations is a
 *   `forkCancelableTimeout` fiber: fork on arm, interrupt (via a cancel
 *   latch) on disarm, exactly the old `setTimeout`/`clearTimeout` pair.
 */

import { Deferred, Effect, Layer, ManagedRuntime } from "effect";

/** Shared runtime for every Effect run in `kernel/integrations`. */
export const integrationsRuntime = ManagedRuntime.make(Layer.empty);

/**
 * Fork a bounded, cancelable timeout fiber: after `timeoutMs`, run
 * `onTimeout`. Returns a cancel thunk that both completes the cancel latch
 * (interrupting the pending sleep) and fences a sleep that already won the
 * race but has not run its callback yet — so, like a synchronous
 * `clearTimeout`, a cancel always beats the firing.
 */
export const forkCancelableTimeout = (
  timeoutMs: number,
  onTimeout: () => void,
): (() => void) => {
  let canceled = false;
  const cancelLatch = Deferred.makeUnsafe<void>();
  integrationsRuntime.runFork(
    Effect.raceFirst(
      Effect.sleep(timeoutMs).pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            if (!canceled) onTimeout();
          }),
        ),
      ),
      Deferred.await(cancelLatch),
    ),
  );
  return () => {
    canceled = true;
    Deferred.doneUnsafe(cancelLatch, Effect.void);
  };
};

