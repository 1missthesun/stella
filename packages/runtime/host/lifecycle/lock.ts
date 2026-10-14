import { closeSync, openSync, writeFileSync, promises as fsPromises } from "node:fs";
import { Effect, type Scope } from "effect";
import { HostLockBusyError, HostLockTimeoutError } from "./errors.js";
import { pollWithDeadline } from "./poll.js";

const ACQUIRE_POLL_INTERVAL_MS = 50;

export type HostLockHandle = {
  readonly lockFile: string;
  readonly fd: number;
};

const tryAcquireLockFile = (
  lockFile: string,
): Effect.Effect<HostLockHandle, HostLockBusyError | Error> =>
  Effect.gen(function* () {
    let fd: number;
    try {
      fd = openSync(lockFile, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        return yield* Effect.fail(error as Error);
      }
      yield* takeOverStaleLock(lockFile);
      return yield* Effect.fail(new HostLockBusyError({ lockFile }));
    }
    try {
      writeFileSync(fd, String(process.pid), "utf-8");
    } catch (error) {
      closeSync(fd);
      yield* Effect.promise(() =>
        fsPromises.unlink(lockFile).catch(() => undefined),
      );
      return yield* Effect.fail(error as Error);
    }
    return { lockFile, fd };
  });

const takeOverStaleLock = (lockFile: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      const raw = await fsPromises.readFile(lockFile, "utf-8");
      const pid = Number.parseInt(raw.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return;
        } catch {
          // Holder is dead — fall through to the atomic takeover below.
        }
      }
      const stalePath = `${lockFile}.${process.pid}.stale`;
      try {
        await fsPromises.rename(lockFile, stalePath);
      } catch {
        return;
      }
      await fsPromises.unlink(stalePath).catch(() => undefined);
    } catch {
      // Lock removed by another process; try again.
    }
  });

const releaseLock = (handle: HostLockHandle): Effect.Effect<void> =>
  Effect.promise(async () => {
    try {
      closeSync(handle.fd);
    } catch {
      // Ignore close errors during release.
    }
    await fsPromises.unlink(handle.lockFile).catch(() => undefined);
  });

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
