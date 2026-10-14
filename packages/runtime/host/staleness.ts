import { existsSync, readFileSync, promises as fs } from "node:fs";
import { Effect, Schedule } from "effect";
import type { RuntimePaths } from "../worker/runtime-paths.js";
import {
  computeRuntimeBuildStamp,
  RUNTIME_BUILD_STAMP_UNAVAILABLE,
} from "../worker/runtime-build-stamp.js";

export type WorkerStalenessReason =
  | "pending-restart-flag"
  | "worker-stamp-missing"
  | "build-stamp-mismatch";

export type WorkerStalenessVerdict =
  | { stale: false }
  | { stale: true; reason: WorkerStalenessReason };

export type PendingWorkerRestartRecord = {
  reason: string;
  detectedAtMs: number;
};

const readWorkerReportedBuildStamp = (
  paths: RuntimePaths,
): Effect.Effect<string | null> =>
  Effect.sync(() => {
    try {
      const raw = readFileSync(paths.buildStampFile, "utf-8").trim();
      return raw || null;
    } catch {
      return null;
    }
  });

export const hasPersistedPendingWorkerRestart = (
  paths: RuntimePaths,
): Effect.Effect<boolean> =>
  Effect.sync(() => existsSync(paths.pendingWorkerRestartFile));

export const evaluateWorkerStaleness = (args: {
  attachedToExistingWorker: boolean;
  paths: RuntimePaths;
  workerEntryPath: string;
}): Effect.Effect<WorkerStalenessVerdict> =>
  Effect.gen(function* () {
    if (!args.attachedToExistingWorker) {
      return { stale: false };
    }
    if (yield* hasPersistedPendingWorkerRestart(args.paths)) {
      return { stale: true, reason: "pending-restart-flag" };
    }
    const workerStamp = yield* readWorkerReportedBuildStamp(args.paths);
    if (!workerStamp) {
      // Pre-stamp worker (older build) — by definition running old code.
      return { stale: true, reason: "worker-stamp-missing" };
    }
    const onDiskStamp = computeRuntimeBuildStamp(args.workerEntryPath);
    if (
      onDiskStamp !== RUNTIME_BUILD_STAMP_UNAVAILABLE &&
      workerStamp !== onDiskStamp
    ) {
      return { stale: true, reason: "build-stamp-mismatch" };
    }
    return { stale: false };
  });

export const persistPendingWorkerRestartFlag = (
  paths: RuntimePaths,
  record: PendingWorkerRestartRecord,
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await fs.mkdir(paths.rootDir, { recursive: true });
      await fs.writeFile(
        paths.pendingWorkerRestartFile,
        JSON.stringify(record, null, 2),
        "utf-8",
      );
    },
    catch: (error) => error as Error,
  });

export const clearPendingWorkerRestartFlag = (
  paths: RuntimePaths,
): Effect.Effect<void> =>
  Effect.promise(() =>
    fs.unlink(paths.pendingWorkerRestartFile).catch(() => undefined),
  ).pipe(Effect.asVoid);

export const quiescencePollEffect = (
  flush: () => Promise<void>,
  intervalMs = 30_000,
): Effect.Effect<void> =>
  Effect.sleep(intervalMs).pipe(
    Effect.andThen(
      Effect.repeat(
        Effect.ignore(Effect.tryPromise(() => flush())),
        Schedule.fixed(intervalMs),
      ),
    ),
    Effect.asVoid,
  );
