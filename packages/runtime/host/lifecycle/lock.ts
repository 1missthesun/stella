import { Effect, type Scope } from "effect";
import { HostLockBusyError, HostLockTimeoutError } from "./errors.js";
import {
  type LockOwner,
  releaseOwnerLock,
  tryAcquireOwnerLock,
} from "./owner-lock.js";
import { pollWithDeadline } from "./poll.js";

const ACQUIRE_POLL_INTERVAL_MS = 50;

export type HostLockHandle = {
  readonly lockFile: string;
  readonly owner: LockOwner;
};

const tryAcquireLockFile = (
  lockFile: string,
): Effect.Effect<HostLockHandle, HostLockBusyError | Error> =>
  Effect.try({
    try: () => tryAcquireOwnerLock(lockFile),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(
    Effect.flatMap((result) =>
      result.acquired
        ? Effect.succeed({ lockFile, owner: result.owner })
        : Effect.fail(new HostLockBusyError({ lockFile })),
    ),
  );

const releaseLock = (handle: HostLockHandle): Effect.Effect<void> =>
  Effect.sync(() => releaseOwnerLock(handle.lockFile, handle.owner));

export const acquireHostLock = (
  lockFile: string,
  timeoutMs: number,
): Effect.Effect<HostLockHandle, HostLockTimeoutError | Error, Scope.Scope> =>
  Effect.acquireRelease(
    pollWithDeadline({
      timeoutMs,
      intervalMs: ACQUIRE_POLL_INTERVAL_MS,
      attempt: tryAcquireLockFile(lockFile),
      retryWhile: (error) => error instanceof HostLockBusyError,
      onDeadline: () => new HostLockTimeoutError({ lockFile, timeoutMs }),
    }),
    (handle) => releaseLock(handle),
  );
