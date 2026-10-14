import * as Cause from "effect/Cause";
import * as Data from "effect/Data";

/**
 * Tagged failures for the host-side worker lifecycle. The plain-Promise
 * facade in `host/lifecycle.ts` rethrows these across the Effect boundary,
 * so every escaping message is byte-identical to the string the pre-Effect
 * `host/lifecycle.ts` threw. Do not reword them.
 */

export class HostLockTimeoutError extends Data.TaggedError(
  "@stella/runtime/host/HostLockTimeoutError",
)<{
  readonly lockFile: string;
  readonly timeoutMs: number;
}> {
  override get message() {
    return `Timed out acquiring runtime host lock at ${this.lockFile} after ${this.timeoutMs}ms.`;
  }
}

export class WorkerProtocolMismatchError extends Data.TaggedError(
  "@stella/runtime/host/WorkerProtocolMismatchError",
)<{ readonly socketPath: string }> {
  override get message() {
    return `Runtime worker protocol mismatch while waiting for socket=${this.socketPath}.`;
  }
}

export class WorkerReadyTimeoutError extends Data.TaggedError(
  "@stella/runtime/host/WorkerReadyTimeoutError",
)<{ readonly socketPath: string }> {
  override get message() {
    return `Timed out waiting for runtime worker to become ready (socket=${this.socketPath}).`;
  }
}

export class HostLockBusyError extends Data.TaggedError(
  "@stella/runtime/host/HostLockBusyError",
)<{ readonly lockFile: string }> {}

export class WorkerNotReadyError extends Data.TaggedError(
  "@stella/runtime/host/WorkerNotReadyError",
)<{ readonly socketPath: string }> {}

export const causeToThrowable = (cause: Cause.Cause<unknown>): unknown =>
  Cause.squash(cause);
