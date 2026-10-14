import type { Socket } from "node:net";
import { promises as fsPromises } from "node:fs";
import { Effect, type Scope } from "effect";
import {
  ensureRuntimeIpcDir,
  resolveRuntimePaths,
  type RuntimePaths,
} from "../../worker/runtime-paths.js";
import {
  probeRunningWorker,
  probeRunningWorkerOwner,
  removeStaleRuntimeArtifacts,
} from "../../worker/lifecycle-server.js";
import { getFileLogger } from "../../observability/file-logger.js";
import type { ExpectedRuntimeServerIdentity } from "../../worker/server-identity.js";
import {
  WorkerNotReadyError,
  WorkerProtocolMismatchError,
  WorkerReadyTimeoutError,
} from "./errors.js";
import { acquireHostLock } from "./lock.js";
import { pollWithDeadline } from "./poll.js";
import { connectReadySocket } from "./socket.js";
import { spawnAdoptedWorker } from "./spawn.js";
import { processIdentityIsLive } from "../../kernel/shared/process-identity.js";
import { findSameRootWorkerPids, killWorkerProcess, stopPids } from "./kill.js";
import {
  defaultLifecycleBudgets,
  type LifecycleBudgets,
  type LifecycleConnection,
  type LifecycleStartOptions,
} from "./options.js";

const hostExecutableMatches = (
  paths: RuntimePaths,
  expectedHostExecutablePath?: string,
): Effect.Effect<boolean> =>
  Effect.promise(async () => {
    if (!expectedHostExecutablePath) return true;
    try {
      const raw = await fsPromises.readFile(paths.hostExecutableFile, "utf-8");
      return raw.trim() === expectedHostExecutablePath;
    } catch {
      return false;
    }
  });

export const pollForWorkerReady = (
  paths: RuntimePaths,
  timeoutMs: number,
  budgets: LifecycleBudgets,
  expectedProtocolVersion?: string,
  expectedIdentity?: ExpectedRuntimeServerIdentity,
  onReadyIdentity?: (identity: LifecycleConnection["identity"]) => void,
): Effect.Effect<
  Socket,
  WorkerProtocolMismatchError | WorkerReadyTimeoutError,
  Scope.Scope
> =>
  pollWithDeadline({
    timeoutMs,
    intervalMs: budgets.startPollIntervalMs,
    attempt: connectReadySocket(
      paths.socketPath,
      budgets.socketConnectTimeoutMs,
      expectedProtocolVersion,
      expectedIdentity,
    ).pipe(
      Effect.flatMap(
        (
          result,
        ): Effect.Effect<
          Socket,
          WorkerNotReadyError | WorkerProtocolMismatchError
        > =>
          result.status === "ready"
            ? Effect.sync(() => {
                onReadyIdentity?.(result.identity);
                return result.socket;
              })
            : result.status === "version-mismatch" ||
                result.status === "identity-mismatch"
              ? Effect.fail(
                  new WorkerProtocolMismatchError({
                    socketPath: paths.socketPath,
                  }),
                )
              : Effect.fail(
                  new WorkerNotReadyError({ socketPath: paths.socketPath }),
                ),
      ),
    ),
    retryWhile: (error) => error instanceof WorkerNotReadyError,
    onDeadline: () =>
      new WorkerReadyTimeoutError({ socketPath: paths.socketPath }),
  }).pipe(
    Effect.mapError((error) =>
      error instanceof WorkerNotReadyError
        ? new WorkerReadyTimeoutError({ socketPath: paths.socketPath })
        : error,
    ),
  );

const expectedIdentityFor = (
  options: LifecycleStartOptions,
  paths: RuntimePaths,
  pid: number | undefined,
): ExpectedRuntimeServerIdentity | undefined =>
  options.verifyIdentity
    ? {
        rootHash: paths.rootHash,
        ...(pid != null ? { pid } : {}),
        launchEnv: options.verifyIdentity.launchEnv,
      }
    : undefined;

const stopRunningWorkerForRestart = (
  stellaAppDir: string,
): Effect.Effect<void> => Effect.asVoid(stopRunningWorkerEffect(stellaAppDir));

const discoverExistingWorker = (
  options: LifecycleStartOptions,
  paths: RuntimePaths,
  budgets: LifecycleBudgets,
): Effect.Effect<LifecycleConnection | null, never, Scope.Scope> =>
  Effect.gen(function* () {
    const existingPid = yield* Effect.promise(() =>
      probeRunningWorker(options.stellaAppDir),
    );
    if (existingPid == null) {
      yield* Effect.promise(() =>
        removeStaleRuntimeArtifacts(options.stellaAppDir),
      );
      return null;
    }
    const executableMatches = yield* hostExecutableMatches(
      paths,
      options.hostExecutablePath,
    );
    if (!executableMatches) {
      console.warn(
        `[runtime-host] Existing worker executable mismatch; restarting detached worker (pid=${existingPid}). In-flight work cannot be preserved across host bundle changes.`,
      );
      yield* stopRunningWorkerForRestart(options.stellaAppDir);
      yield* Effect.promise(() =>
        removeStaleRuntimeArtifacts(options.stellaAppDir),
      );
      return null;
    }
    const expectedIdentity = expectedIdentityFor(options, paths, existingPid);
    const ready = yield* connectReadySocket(
      paths.socketPath,
      budgets.socketConnectTimeoutMs,
      options.expectedProtocolVersion,
      expectedIdentity,
    );
    if (ready.status === "ready") {
      return {
        socket: ready.socket,
        pid: existingPid,
        paths,
        spawned: false,
        ...(expectedIdentity ? { identity: ready.identity } : {}),
      };
    }
    if (ready.status === "identity-mismatch") {
      console.warn(
        `[runtime-host] Existing runtime failed the identity handshake (${ready.mismatch}); restarting detached worker (pid=${existingPid}).`,
      );
      getFileLogger()?.process("host.runtime-identity-mismatch", {
        pid: existingPid,
        mismatch: ready.mismatch,
        serverId: ready.identity?.serverId ?? null,
        reportedPid: ready.identity?.pid ?? null,
      });
      yield* stopRunningWorkerForRestart(options.stellaAppDir);
      const survivors = yield* Effect.promise(() =>
        findSameRootWorkerPids(options.workerEntryPath, options.stellaAppDir),
      );
      if (survivors.length > 0) yield* stopPids(survivors);
      yield* Effect.promise(() =>
        removeStaleRuntimeArtifacts(options.stellaAppDir),
      );
      return null;
    }
    if (ready.status === "version-mismatch") {
      console.warn(
        `[runtime-host] Existing worker protocol mismatch; restarting detached worker (pid=${existingPid}). In-flight work cannot be preserved across protocol changes.`,
      );
      yield* stopRunningWorkerForRestart(options.stellaAppDir);
      yield* Effect.promise(() =>
        removeStaleRuntimeArtifacts(options.stellaAppDir),
      );
      return null;
    }
    let retryIdentity: LifecycleConnection["identity"] = null;
    const retry = yield* pollForWorkerReady(
      paths,
      budgets.staleRetryTimeoutMs,
      budgets,
      options.expectedProtocolVersion,
      expectedIdentity,
      (identity) => {
        retryIdentity = identity;
      },
    ).pipe(Effect.catch(() => Effect.succeed(null)));
    if (retry) {
      return {
        socket: retry,
        pid: existingPid,
        paths,
        spawned: false,
        ...(expectedIdentity ? { identity: retryIdentity } : {}),
      };
    }
    // Truly stale; only reap processes whose command line still matches
    // this Stella root. A pidfile can outlive the original worker, and
    // the OS may have reused that pid for an unrelated process.
    const orphanPids = yield* Effect.promise(() =>
      findSameRootWorkerPids(options.workerEntryPath, options.stellaAppDir),
    );
    if (!orphanPids.includes(existingPid)) {
      console.warn(
        `[runtime-host] Stale runtime pidfile pointed at pid ${existingPid}, but that pid no longer matches this worker root; leaving the process alone.`,
      );
    }
    if (orphanPids.length > 0) {
      console.warn(
        `[runtime-host] Reaping ${orphanPids.length} stale runtime worker(s) for ${options.stellaAppDir} before spawning a fresh worker.`,
      );
      yield* stopPids(orphanPids);
    }
    yield* Effect.promise(() =>
      removeStaleRuntimeArtifacts(options.stellaAppDir),
    );
    return null;
  });

export const startOrAttachWorkerEffect = (
  options: LifecycleStartOptions,
  budgets: LifecycleBudgets = defaultLifecycleBudgets,
): Effect.Effect<LifecycleConnection, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const paths = resolveRuntimePaths(options.stellaAppDir);
    yield* Effect.promise(() =>
      Promise.all([
        fsPromises.mkdir(paths.rootDir, { recursive: true }),
        ensureRuntimeIpcDir(paths),
      ]),
    );
    const hostLockFile = `${paths.lockFile}.host`;
    yield* acquireHostLock(hostLockFile, budgets.hostLockTimeoutMs);

    const existing = yield* discoverExistingWorker(options, paths, budgets);
    if (existing) {
      return existing;
    }

    yield* spawnAdoptedWorker(options, paths);
    const expectedIdentity = expectedIdentityFor(options, paths, undefined);
    let spawnedIdentity: LifecycleConnection["identity"] = null;
    const socket = yield* pollForWorkerReady(
      paths,
      budgets.startTimeoutMs,
      budgets,
      options.expectedProtocolVersion,
      expectedIdentity,
      (identity) => {
        spawnedIdentity = identity;
      },
    );
    const newPid =
      (yield* Effect.promise(() => probeRunningWorker(options.stellaAppDir))) ??
      0;
    return {
      socket,
      pid: newPid,
      paths,
      spawned: true,
      ...(expectedIdentity ? { identity: spawnedIdentity } : {}),
    };
  });

export const stopRunningWorkerEffect = (
  stellaAppDir: string,
  options?: { graceMs?: number },
): Effect.Effect<{ stopped: boolean; pid: number | null }> =>
  Effect.gen(function* () {
    const owner = yield* Effect.promise(() =>
      probeRunningWorkerOwner(stellaAppDir),
    );
    if (owner == null) return { stopped: false, pid: null };
    const pid = owner.pid;
    const startedAt = Date.now();
    const result = yield* killWorkerProcess(pid, options?.graceMs ?? 1_500, () =>
      processIdentityIsLive(owner.pid, owner.identity),
    );
    getFileLogger()?.process("worker.kill-latency", {
      pid,
      ms: Date.now() - startedAt,
      escalatedToSigkill: result.escalatedToSigkill,
      stopped: result.stopped,
    });
    return { stopped: result.stopped, pid };
  });
