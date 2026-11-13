import { Deferred, Effect, Fiber } from "effect";
import {
  createRuntimeUnavailableError,
  type JsonRpcPeer,
} from "@stella/contracts/protocol/rpc-peer";
import type {
  AgentHealth,
  RuntimeActiveRun,
} from "@stella/contracts/protocol";
import { hostRuntime, runHostEffect } from "./effect-runtime.js";

export interface WorkerProcess {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdin: { end(): void } | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  off(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type WorkerConnection = {
  process: WorkerProcess;
  peer: JsonRpcPeer;
  pid: number;
  attachedToExistingWorker?: boolean;
};

export type WorkerLifecycleState = "idle" | "starting" | "running" | "stopping";

export type WorkerHealthSnapshot = {
  health: AgentHealth;
  activeRun: RuntimeActiveRun | null;
  activeAgentCount: number;
  protocolVersion?: string;
  pid: number;
  deviceId: string | null;
  voiceBusy?: boolean;
  pendingVoiceRequestCount?: number;
  piBusy?: boolean;
  /** Stella is mid-reply in a chat here. */
  piReplying?: boolean;
};

const waitForWorkerProcessExitEffect = (
  child: WorkerProcess,
  timeoutMs: number,
): Effect.Effect<void> =>
  Effect.raceFirst(
    Effect.callback<void>((resume) => {
      const finish = () => resume(Effect.void);
      child.once("exit", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
      return Effect.sync(() => {
        child.off("exit", finish);
      });
    }),
    Effect.sleep(timeoutMs).pipe(
      Effect.andThen(
        Effect.sync(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // Best effort during process shutdown.
          }
        }),
      ),
      Effect.andThen(disconnectWorkerEffect(child, SIGKILL_EXIT_WAIT_MS)),
    ),
  );

const SIGKILL_EXIT_WAIT_MS = 1_000;

const disconnectWorkerEffect = (
  child: WorkerProcess,
  timeoutMs: number,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (child.exitCode != null || child.signalCode != null) {
      try {
        child.stdin?.end();
      } catch {
        // Best effort.
      }
      return Effect.void;
    }
    return Effect.raceFirst(
      Effect.callback<void>((resume) => {
        const finish = () => resume(Effect.void);
        child.once("exit", finish);
        try {
          child.stdin?.end();
        } catch {
          // Best effort.
        }
        return Effect.sync(() => {
          child.off("exit", finish);
        });
      }),
      Effect.sleep(timeoutMs),
    );
  });

export type RuntimeWorkerLifecycleControllerOptions = {
  workerEntryPath: string;
  isHostStarted: () => boolean;
  createConnectionAsync: (workerEntryPath: string) => Promise<WorkerConnection>;
  initializeConnection: (connection: WorkerConnection) => Promise<void>;
  onConnectionStarted: (connection: WorkerConnection) => Promise<void>;
  onUnexpectedExit: () => Promise<void> | void;
  onAfterStop: (reason: "idle" | "restart" | "stopped") => Promise<void> | void;
  onStateChange?: (state: WorkerLifecycleState) => void;
  fetchHealth: (
    connection: WorkerConnection,
  ) => Promise<WorkerHealthSnapshot | null>;
  killWorkerOnStop?: (reason: "idle" | "restart" | "stopped") => boolean;
  killWorker?: () => Promise<void>;
};

/**
 * The host-side worker lifecycle. Exit and close events act only when they
 * come from the current connection, so a stopped worker that exits late can't
 * reset or replace its successor.
 */
export class RuntimeWorkerLifecycleController {
  private connection: WorkerConnection | null = null;
  private startupPromise: Promise<void> | null = null;
  private stopPromise: Promise<boolean> | null = null;
  private readonly intentionalStops = new WeakSet<WorkerConnection>();
  private retired = false;
  private state: WorkerLifecycleState = "idle";
  private inFlightWorkerRequests = 0;
  private inFlightDrainLatch: Deferred.Deferred<void> | null = null;

  constructor(
    private readonly options: RuntimeWorkerLifecycleControllerOptions,
  ) {}

  getState() {
    return this.state;
  }

  getConnection() {
    return this.connection;
  }

  private getLivePeer() {
    const peer = this.connection?.peer;
    return peer && !peer.isClosed() ? peer : null;
  }

  private setState(nextState: WorkerLifecycleState) {
    this.state = nextState;
    this.options.onStateChange?.(nextState);
  }

  private getOrCreateInFlightDrainLatch() {
    if (this.inFlightDrainLatch) {
      return this.inFlightDrainLatch;
    }
    this.inFlightDrainLatch = Deferred.makeUnsafe<void>();
    return this.inFlightDrainLatch;
  }

  private incrementInFlightWorkerRequests() {
    this.inFlightWorkerRequests += 1;
  }

  private decrementInFlightWorkerRequests() {
    this.inFlightWorkerRequests = Math.max(0, this.inFlightWorkerRequests - 1);
    if (this.inFlightWorkerRequests === 0 && this.inFlightDrainLatch) {
      const latch = this.inFlightDrainLatch;
      this.inFlightDrainLatch = null;
      Deferred.doneUnsafe(latch, Effect.void);
    }
  }

  private async waitForInFlightWorkerRequestsToDrain(timeoutMs = 1_500) {
    if (this.inFlightWorkerRequests === 0) {
      return;
    }
    const latch = this.getOrCreateInFlightDrainLatch();
    await hostRuntime.runPromise(
      Effect.raceFirst(Deferred.await(latch), Effect.sleep(timeoutMs)),
    );
  }

  private startupEffect(): Effect.Effect<void, unknown> {
    const self = this;
    return Effect.gen(function* () {
      const connection = yield* Effect.tryPromise({
        try: () =>
          self.options.createConnectionAsync(self.options.workerEntryPath),
        catch: (error) => error,
      });
      self.connection = connection;

      connection.peer.on("closed", () => {
        if (self.connection?.peer !== connection.peer) {
          return;
        }
        self.connection = null;
        if (self.state === "running") {
          self.setState("idle");
        }
      });

      connection.process.once("exit", () => {
        if (self.connection !== connection) return;
        self.connection = null;
        if (self.intentionalStops.has(connection)) return;
        self.setState("idle");
        if (self.options.isHostStarted()) {
          void self.options.onUnexpectedExit();
        }
      });

      yield* Effect.tryPromise({
        try: () => self.options.initializeConnection(connection),
        catch: (error) => error,
      }).pipe(
        Effect.andThen(
          Effect.tryPromise({
            try: () => self.options.onConnectionStarted(connection),
            catch: (error) => error,
          }),
        ),
        Effect.andThen(Effect.sync(() => self.setState("running"))),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (self.connection === connection) {
              self.connection = null;
            }
            self.setState("idle");
          }).pipe(
            Effect.andThen(
              Effect.ignore(
                waitForWorkerProcessExitEffect(connection.process, 1_500),
              ),
            ),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
    });
  }

  async ensureStarted() {
    if (!this.options.isHostStarted()) {
      throw createRuntimeUnavailableError(
        "Stella runtime host is not started.",
      );
    }
    if (this.retired) {
      throw createRuntimeUnavailableError("Stella runtime is restarting.");
    }
    if (this.state === "running" && this.getLivePeer()) return;
    if (this.state === "stopping" && this.stopPromise) {
      await this.stopPromise;
      if (this.getState() === "running" && this.getLivePeer()) return;
    }
    if (this.startupPromise) {
      await this.startupPromise;
      return;
    }

    this.setState("starting");
    const startupFiber = hostRuntime.runFork(this.startupEffect());
    this.startupPromise = runHostEffect(Fiber.join(startupFiber));

    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
      if (!this.connection?.peer && this.state === "starting") {
        this.setState("idle");
      }
    }
  }

  /**
   * Stops the current worker. `stillIdle` is asked after new requests are held
   * (state `stopping`) and in-flight ones have drained, right before the kill;
   * returning false keeps the worker running and resolves `false`. `retire`
   * refuses every later start (the process itself is about to restart).
   */
  async stop(
    reason: "idle" | "restart" | "stopped",
    options: { stillIdle?: () => Promise<boolean>; retire?: boolean } = {},
  ): Promise<boolean> {
    while (this.stopPromise) {
      await this.stopPromise;
    }
    const connection = this.connection;
    if (!connection) return true;
    const resumeState = this.state;
    this.setState("stopping");
    this.stopPromise = this.stopConnection(connection, reason, resumeState, options)
      .finally(() => {
        this.stopPromise = null;
      });
    const stopped = await this.stopPromise;
    if (stopped && this.options.isHostStarted()) {
      await this.options.onAfterStop(reason);
    }
    return stopped;
  }

  private async stopConnection(
    connection: WorkerConnection,
    reason: "idle" | "restart" | "stopped",
    resumeState: WorkerLifecycleState,
    options: { stillIdle?: () => Promise<boolean>; retire?: boolean },
  ): Promise<boolean> {
    if (reason !== "idle") {
      await this.waitForInFlightWorkerRequestsToDrain();
    }
    if (
      options.stillIdle &&
      this.connection === connection &&
      !(await options.stillIdle().catch(() => false)) &&
      this.connection === connection
    ) {
      this.setState(resumeState);
      return false;
    }
    this.intentionalStops.add(connection);
    if (options.retire) this.retired = true;
    const shouldKill = this.options.killWorkerOnStop?.(reason) ?? true;
    const killWorker = this.options.killWorker;
    const stopCore: Effect.Effect<void, unknown> = shouldKill
      ? killWorker
        ? Effect.tryPromise({
            try: () => killWorker(),
            catch: (error) => error,
          }).pipe(Effect.andThen(disconnectWorkerEffect(connection.process, 100)))
        : waitForWorkerProcessExitEffect(connection.process, 1_500)
      : disconnectWorkerEffect(connection.process, 1_500);
    await runHostEffect(
      stopCore.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (this.connection === connection) {
              this.connection = null;
            }
            this.setState("idle");
          }),
        ),
      ),
    );
    return true;
  }

  async request<TResult>(
    execute: (peer: JsonRpcPeer) => Promise<TResult>,
    options: {
      ensureWorker: boolean;
      recordActivity: boolean;
      retryOnceOnDisconnect?: boolean;
    },
  ): Promise<TResult> {
    if (options.ensureWorker) {
      do {
        await this.ensureStarted();
      } while (this.getState() === "stopping");
    }
    const peer = this.getLivePeer();
    if (!peer) {
      throw createRuntimeUnavailableError("Runtime worker is not running.");
    }
    this.incrementInFlightWorkerRequests();
    try {
      return await execute(peer);
    } catch (error) {
      if (
        options.retryOnceOnDisconnect &&
        this.options.isHostStarted() &&
        !this.getLivePeer()
      ) {
        await this.ensureStarted();
        return await this.request(execute, {
          ...options,
          retryOnceOnDisconnect: false,
        });
      }
      throw error;
    } finally {
      this.decrementInFlightWorkerRequests();
    }
  }

  async getHealth(args: { ensureWorker: boolean }) {
    if (args.ensureWorker) {
      await this.ensureStarted();
    }
    const connection = this.connection;
    if (!connection || connection.peer.isClosed()) return null;
    return await this.options.fetchHealth(connection);
  }
}
