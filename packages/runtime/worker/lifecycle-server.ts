import { createWriteStream, promises as fsPromises, type WriteStream } from "node:fs";
import {
  type LockOwner,
  readLiveLockOwner,
  releaseOwnerLock,
  tryAcquireOwnerLock,
} from "../host/lifecycle/owner-lock.js";
import { getFileLogger } from "../observability/file-logger.js";
import { forkDelayed, type WorkerTimerHandle } from "./effect-runtime.js";
import {
  ensureRuntimeIpcDir,
  resolveRuntimePaths,
  runtimeIpcPathUsesFilesystem,
  type RuntimePaths,
} from "./runtime-paths.js";

export type LifecycleServerOptions = {
  stellaAppDir: string;
  idleShutdownMs?: number;
  interruptWork?: () => Promise<void>;
  shouldKeepAlive?: () => Promise<boolean> | boolean;
  runtimeBuildStamp?: string;
  onShutdown: (reason: "idle" | "signal" | "restart") => Promise<void> | void;
};

const DEFAULT_IDLE_SHUTDOWN_MS = 10_000;
const INTERRUPT_WORK_TIMEOUT_MS = 4_000;

export class WorkerLifecycleServer {
  readonly paths: RuntimePaths;
  private lockOwner: LockOwner | null = null;
  private logStream: WriteStream | null = null;
  private idleTimer: WorkerTimerHandle | null = null;
  private clientCount = 0;
  private shuttingDown = false;
  private quitRequested = false;
  private readonly idleShutdownMs: number;

  constructor(private readonly options: LifecycleServerOptions) {
    this.paths = resolveRuntimePaths(options.stellaAppDir);
    this.idleShutdownMs = options.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS;
  }

  async start(): Promise<void> {
    await fsPromises.mkdir(this.paths.rootDir, { recursive: true });
    await ensureRuntimeIpcDir(this.paths);
    await fsPromises.mkdir(this.paths.logDir, { recursive: true });

    const lock = tryAcquireOwnerLock(this.paths.lockFile);
    if (!lock.acquired) {
      throw new Error(
        `Another runtime worker is already running for ${this.options.stellaAppDir} (pid ${lock.holder?.pid ?? "unknown"}, lock at ${this.paths.lockFile}).`,
      );
    }
    this.lockOwner = lock.owner;

    await fsPromises.writeFile(
      this.paths.pidFile,
      String(process.pid),
      "utf-8",
    );
    await fsPromises.writeFile(
      this.paths.rootMarkerFile,
      `${this.options.stellaAppDir}\n`,
      "utf-8",
    );
    const hostExecutablePath = process.env.STELLA_HOST_EXECUTABLE_PATH;
    if (hostExecutablePath) {
      await fsPromises.writeFile(
        this.paths.hostExecutableFile,
        `${hostExecutablePath}\n`,
        "utf-8",
      );
    }
    if (this.options.runtimeBuildStamp) {
      await fsPromises.writeFile(
        this.paths.buildStampFile,
        `${this.options.runtimeBuildStamp}\n`,
        "utf-8",
      );
    } else {
      await fsPromises.unlink(this.paths.buildStampFile).catch(() => undefined);
    }

    this.logStream = createWriteStream(this.paths.logFile, {
      flags: "a",
      encoding: "utf-8",
    });
    this.logStream.write(
      `\n[${new Date().toISOString()}] worker pid=${process.pid} listening (root=${this.options.stellaAppDir})\n`,
    );
    getFileLogger()?.process("worker.listening", {
      pid: process.pid,
      rootHash: this.paths.rootHash,
      idleShutdownMs: this.idleShutdownMs,
      startupMs: Math.round(process.uptime() * 1000),
    });

    this.scheduleIdleShutdown();
  }

  noteClientConnected() {
    this.clientCount += 1;
    this.quitRequested = false;
    if (this.idleTimer) {
      this.idleTimer.cancel();
      this.idleTimer = null;
    }
  }

  noteClientDisconnected() {
    this.clientCount = Math.max(0, this.clientCount - 1);
    if (this.clientCount > 0) return;
    if (this.quitRequested) {
      this.idleTimer?.cancel();
      this.idleTimer = null;
      void this.evaluateIdleShutdown();
      return;
    }
    this.scheduleIdleShutdown();
  }

  async requestQuit(): Promise<void> {
    this.quitRequested = true;
    const startedAt = Date.now();
    await this.interruptWork();
    getFileLogger()?.process("worker.quit-work-interrupted", {
      elapsedMs: Date.now() - startedAt,
    });
  }

  private async interruptWork() {
    const interrupt = this.options.interruptWork;
    if (!interrupt) return;
    let deadline: WorkerTimerHandle | null = null;
    const timedOut = await Promise.race([
      interrupt().then(
        () => false,
        (error: unknown) => {
          this.logStream?.write(
            `[${new Date().toISOString()}] interrupting work failed: ${(error as Error)?.message ?? String(error)}\n`,
          );
          return false;
        },
      ),
      new Promise<boolean>((resolve) => {
        deadline = forkDelayed(INTERRUPT_WORK_TIMEOUT_MS, () => resolve(true));
      }),
    ]);
    (deadline as WorkerTimerHandle | null)?.cancel();
    if (timedOut) {
      this.logStream?.write(
        `[${new Date().toISOString()}] interrupting work exceeded ${INTERRUPT_WORK_TIMEOUT_MS}ms; continuing shutdown\n`,
      );
    }
  }

  private scheduleIdleShutdown() {
    if (this.shuttingDown) return;
    this.idleTimer?.cancel();
    this.idleTimer = forkDelayed(this.idleShutdownMs, () => {
      this.idleTimer = null;
      void this.evaluateIdleShutdown();
    });
  }

  private async evaluateIdleShutdown() {
    if (this.shuttingDown || this.clientCount > 0) return;
    await this.interruptWork();
    if (this.shuttingDown || this.clientCount > 0) return;
    const keepAlive = await Promise.resolve(
      this.options.shouldKeepAlive?.() ?? false,
    ).catch((error) => {
      this.logStream?.write(
        `[${new Date().toISOString()}] keep-alive check failed: ${(error as Error).message}\n`,
      );
      return true;
    });
    if (keepAlive) {
      this.logStream?.write(
        `[${new Date().toISOString()}] worker has active work; delaying idle shutdown\n`,
      );
      this.scheduleIdleShutdown();
      return;
    }
    this.logStream?.write(
      `[${new Date().toISOString()}] worker idle for ${this.idleShutdownMs}ms with no active work, shutting down\n`,
    );
    await this.shutdown("idle");
  }

  async shutdown(reason: "idle" | "signal" | "restart"): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    getFileLogger()?.process("worker.shutdown", {
      pid: process.pid,
      reason,
    });
    if (this.idleTimer) {
      this.idleTimer.cancel();
      this.idleTimer = null;
    }
    try {
      await this.options.onShutdown(reason);
    } catch (error) {
      this.logStream?.write(
        `[${new Date().toISOString()}] shutdown handler error: ${(error as Error).message}\n`,
      );
      getFileLogger()?.error("worker.shutdown-handler-error", {
        reason,
        error,
      });
    }
    await this.releaseFiles();
    this.logStream?.end();
    this.logStream = null;
  }

  private async releaseFiles() {
    if (this.lockOwner) {
      releaseOwnerLock(this.paths.lockFile, this.lockOwner);
      this.lockOwner = null;
    }
    await fsPromises.unlink(this.paths.pidFile).catch(() => undefined);
  }
}

export const probeRunningWorkerOwner = async (
  stellaAppDir: string,
): Promise<LockOwner | null> =>
  readLiveLockOwner(resolveRuntimePaths(stellaAppDir).lockFile);

export const probeRunningWorker = async (
  stellaAppDir: string,
): Promise<number | null> =>
  (await probeRunningWorkerOwner(stellaAppDir))?.pid ?? null;

export const removeStaleRuntimeArtifacts = async (
  stellaAppDir: string,
): Promise<void> => {
  const paths = resolveRuntimePaths(stellaAppDir);
  const maybeFilePaths = [
    paths.pidFile,
    paths.lockFile,
    paths.hostExecutableFile,
    paths.buildStampFile,
  ];
  if (runtimeIpcPathUsesFilesystem(paths.socketPath)) {
    maybeFilePaths.push(paths.socketPath);
  }
  if (runtimeIpcPathUsesFilesystem(paths.cliBridgeSocketPath)) {
    maybeFilePaths.push(paths.cliBridgeSocketPath);
  }
  for (const filePath of maybeFilePaths) {
    await fsPromises.unlink(filePath).catch(() => undefined);
  }
};

