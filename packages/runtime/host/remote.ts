import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { attachJsonRpcPeerToStreams } from "@stella/contracts/protocol/jsonl";
import { RPC_ERROR_CODES } from "@stella/contracts/protocol";
import {
  RpcError,
  createRuntimeUnavailableError,
  type JsonRpcPeer,
} from "@stella/contracts/protocol/rpc-peer";
import {
  RUNTIME_CLIENT_METHODS,
  STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION,
  type RuntimeClientAttachParams,
} from "@stella/contracts/protocol/runtime-client";
import { resolveBundledRuntimeFile } from "../kernel/shared/runtime-paths.js";
import {
  isRuntimeHostHandler,
  RUNTIME_ATTACHMENT_STALE,
  RUNTIME_HOST_CALLS,
  RUNTIME_SERVER_MISMATCH,
  type FencedRuntimeAttachResult,
  type FencedRuntimeCallParams,
  type FencedRuntimeEventParams,
  type FencedRuntimeHostHandlerParams,
  type RuntimeAttachFence,
  type RuntimeHostCall,
  type RuntimeHostHandler,
} from "./client-protocol.js";
import { readRuntimeLaunchEnv } from "../worker/server-identity.js";
import {
  probeRunningWorker,
} from "../worker/lifecycle-server.js";
import { Effect } from "effect";
import {
  forkDelayed,
  runHostEffect,
  type HostTimerHandle,
} from "./effect-runtime.js";
import { startOrAttachWorker } from "./lifecycle.js";

export type RemoteRuntimeHostOptions = {
  initializeParams: RuntimeClientAttachParams["initializeParams"];
  hostHandlers: Partial<
    Record<RuntimeHostHandler, (...args: never[]) => unknown>
  >;
  disableLocalScheduler?: boolean;
  workerEntryPath?: string;
  bunBinaryPath?: string;
};

type Connection = {
  peer: JsonRpcPeer;
  dispose: () => void;
  pid: number;
  attachmentId: string;
  serverId: string | null;
  retired: boolean;
};

const SERVER_MISMATCH_RETRIES = 2;

const FENCE_LOG_WINDOW_MS = 10_000;

const RUNTIME_EXIT_TIMEOUT_MS = 15_000;

const RECONNECT_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 5_000];
const REAP_POLL_MS = 5;

type RuntimeHostCalls = {
  [K in RuntimeHostCall]: (...args: any[]) => Promise<any>;
};

export interface RemoteRuntimeHost extends RuntimeHostCalls {}

export class RemoteRuntimeHost {
  private readonly events = new EventEmitter();
  private connection: Connection | null = null;
  private connecting: Promise<Connection> | null = null;
  private started = false;
  private stopped = false;
  private reconnectTimer: HostTimerHandle | null = null;
  private reconnectAttempt = 0;
  private readonly fenceLogAt = new Map<string, number>();
  private fenceDrops = 0;

  constructor(private readonly options: RemoteRuntimeHostOptions) {
    this.events.setMaxListeners(0);
    for (const method of RUNTIME_HOST_CALLS) {
      this[method] = (...args: unknown[]) => this.call(method, args);
    }
  }

  on(eventName: string, listener: (payload: any) => void): () => void {
    this.events.on(eventName, listener);
    return () => {
      this.events.removeListener(eventName, listener);
    };
  }

  async start(): Promise<void> {
    this.started = true;
    this.stopped = false;
    await this.ensureConnected();
  }

  async stop(
    options: {
      shutdownRuntime?: boolean;
      quit?: boolean;
      exitTimeoutMs?: number;
    } = {},
  ): Promise<void> {
    this.started = false;
    this.stopped = true;
    const shutdownRequested = options.shutdownRuntime
      ? await this.requestRuntimeShutdown(options.quit === true)
      : false;
    this.reconnectTimer?.cancel();
    this.reconnectTimer = null;
    const connection = this.connection;
    this.connection = null;
    if (connection) connection.retired = true;
    connection?.dispose();
    void this.connecting?.then(
      (late) => {
        if (this.started || this.connection !== late) return;
        this.connection = null;
        late.retired = true;
        late.dispose();
      },
      () => undefined,
    );
    this.events.emit("runtime-disconnected", { reason: "stopped" });
    if (shutdownRequested) {
      await this.waitForRuntimeExit(
        options.exitTimeoutMs ?? RUNTIME_EXIT_TIMEOUT_MS,
      );
    }
  }

  private async requestRuntimeShutdown(quit: boolean): Promise<boolean> {
    const connection = this.connection;
    if (!connection || connection.peer.isClosed()) return false;
    await connection.peer
      .request(RUNTIME_CLIENT_METHODS.SHUTDOWN, quit ? { mode: "quit" } : {})
      .catch(() => undefined);
    return true;
  }

  private async waitForRuntimeExit(exitTimeoutMs: number): Promise<void> {
    const stellaAppDir = this.options.initializeParams.stellaAppDir;
    const deadline = Date.now() + exitTimeoutMs;
    while (Date.now() < deadline && (await probeRunningWorker(stellaAppDir)) != null) {
      await runHostEffect(Effect.sleep(50));
    }
  }

  async call(method: RuntimeHostCall, args: unknown[]): Promise<any> {
    if (this.stopped) {
      throw createRuntimeUnavailableError("Stella's runtime has been stopped.");
    }
    const connection = await this.ensureConnected();
    return await connection.peer.request(RUNTIME_CLIENT_METHODS.CALL, {
      method,
      args,
      attachmentId: connection.attachmentId,
    } satisfies FencedRuntimeCallParams);
  }

  private async ensureConnected(): Promise<Connection> {
    const live = this.connection;
    if (live && !live.peer.isClosed()) return live;
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return await this.connecting;
  }

  private async connect(): Promise<Connection> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.connectOnce();
      } catch (error) {
        if (!isServerMismatch(error) || attempt >= SERVER_MISMATCH_RETRIES) {
          throw error;
        }
        console.warn(
          "[runtime-client] Runtime changed between probe and attach; re-probing.",
        );
      }
    }
  }

  private async connectOnce(): Promise<Connection> {
    const stellaAppDir = this.options.initializeParams.stellaAppDir;
    const attached = await startOrAttachWorker({
      stellaAppDir,
      workerEntryPath:
        this.options.workerEntryPath ??
        resolveBundledRuntimeFile("worker/entry.js"),
      ...(this.bunBinaryPath() ? { bunBinaryPath: this.bunBinaryPath() } : {}),
      expectedProtocolVersion: STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION,
      // Under Electron, the runtime's child processes use this binary as
      // Node (ELECTRON_RUN_AS_NODE); a different binary respawns the runtime.
      ...(process.versions.electron ? { hostExecutablePath: process.execPath } : {}),
      verifyIdentity: { launchEnv: readRuntimeLaunchEnv(process.env) },
    });
    const handle = attachJsonRpcPeerToStreams({
      input: attached.socket,
      output: attached.socket,
      onError: (error) => {
        console.error("[runtime-client] RPC error:", error);
      },
    });
    const connection: Connection = {
      peer: handle.peer,
      dispose: () => {
        handle.dispose();
        attached.socket.end();
      },
      pid: attached.identity?.pid ?? attached.pid,
      attachmentId: randomUUID(),
      serverId: attached.identity?.serverId ?? null,
      retired: false,
    };
    handle.peer.registerRequestHandler(
      RUNTIME_CLIENT_METHODS.HOST_HANDLER,
      (params) => this.runHostHandler(connection, params),
    );
    handle.peer.registerNotificationHandler(
      RUNTIME_CLIENT_METHODS.EVENT,
      (params) => {
        const event = params as FencedRuntimeEventParams;
        if (typeof event?.name !== "string") return;
        if (!this.acceptsFrame(connection, event.attachmentId, `event:${event.name}`)) {
          return;
        }
        this.events.emit(event.name, event.payload);
      },
    );
    handle.peer.on("closed", () => this.handleConnectionLost(connection));
    const fence: RuntimeAttachFence = {
      attachmentId: connection.attachmentId,
      expectedRootHash: attached.paths.rootHash,
      ...(connection.serverId ? { expectedServerId: connection.serverId } : {}),
    };
    try {
      const result = await handle.peer.request<FencedRuntimeAttachResult>(
        RUNTIME_CLIENT_METHODS.ATTACH,
        {
          initializeParams: this.options.initializeParams,
          ...(this.options.disableLocalScheduler
            ? { disableLocalScheduler: true }
            : {}),
          ...fence,
        } satisfies RuntimeClientAttachParams & RuntimeAttachFence,
      );
      if (
        (connection.serverId &&
          result.serverId !== undefined &&
          result.serverId !== connection.serverId) ||
        (result.attachmentId !== undefined &&
          result.attachmentId !== connection.attachmentId)
      ) {
        throw new RpcError(
          RPC_ERROR_CODES.INVALID_PARAMS,
          `${RUNTIME_SERVER_MISMATCH}: attached to runtime ${String(result.serverId)} / attachment ${String(result.attachmentId)}, expected ${String(connection.serverId)} / ${connection.attachmentId}.`,
        );
      }
    } catch (error) {
      connection.retired = true;
      handle.dispose();
      throw error;
    }
    if (connection.retired) {
      throw new RpcError(
        RPC_ERROR_CODES.RUNTIME_UNAVAILABLE,
        "The Stella runtime connection closed while attaching.",
      );
    }
    const previous = this.connection;
    if (previous && previous !== connection) {
      previous.retired = true;
      previous.dispose();
    }
    this.connection = connection;
    this.reconnectAttempt = 0;
    this.events.emit("runtime-connected", undefined);
    void this.call("health", []).then(
      (snapshot) => this.events.emit("runtime-ready", snapshot),
      () => undefined,
    );
    return connection;
  }

  private acceptsFrame(
    connection: Connection,
    attachmentId: string | undefined,
    label: string,
  ): boolean {
    let reason: string | null = null;
    if (connection.retired) {
      reason = "retired-connection";
    } else if (!this.started) {
      reason = "client-stopped";
    } else if (
      attachmentId !== undefined &&
      attachmentId !== connection.attachmentId
    ) {
      reason = "attachment-mismatch";
    }
    if (!reason) return true;
    this.noteFenceDrop(reason, label, connection, attachmentId);
    return false;
  }

  private noteFenceDrop(
    reason: string,
    label: string,
    connection: Connection,
    attachmentId: string | undefined,
  ): void {
    this.fenceDrops += 1;
    const now = Date.now();
    const last = this.fenceLogAt.get(reason) ?? 0;
    if (now - last < FENCE_LOG_WINDOW_MS) return;
    this.fenceLogAt.set(reason, now);
    console.warn(
      `[runtime-client] Dropped stale runtime frame (${reason}): ${label} attachment=${String(attachmentId)} connection=${connection.attachmentId} server=${String(connection.serverId)} totalDropped=${this.fenceDrops}`,
    );
  }

  private bunBinaryPath(): string | undefined {
    return (
      this.options.bunBinaryPath ?? (process.env.STELLA_BUN_PATH?.trim() || undefined)
    );
  }

  private handleConnectionLost(connection: Connection): void {
    connection.retired = true;
    if (this.connection !== connection) return;
    this.connection = null;
    this.events.emit("runtime-disconnected", {
      reason: "Stella is reconnecting to its runtime.",
    });
    if (this.started) this.scheduleReconnect(connection.pid);
  }

  private scheduleReconnect(gonePid?: number): void {
    if (this.reconnectTimer || !this.started) return;
    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ]!;
    const first = this.reconnectAttempt === 0 && Boolean(gonePid);
    this.reconnectAttempt += 1;
    const deadline = Date.now() + delay;
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    };
    const wait = () =>
      first && Date.now() < deadline && alive(gonePid!)
        ? REAP_POLL_MS
        : 0;
    const attempt = () => {
      this.reconnectTimer = null;
      if (!this.started) return;
      const more = wait();
      if (more > 0) {
        this.reconnectTimer = forkDelayed(more, attempt);
        return;
      }
      this.ensureConnected().catch((error) => {
        console.warn(
          "[runtime-client] Reconnect failed:",
          error instanceof Error ? error.message : error,
        );
        this.scheduleReconnect();
      });
    };
    this.reconnectTimer = forkDelayed(first ? 0 : delay, attempt);
  }

  private async runHostHandler(
    connection: Connection,
    value: unknown,
  ): Promise<unknown> {
    const params = value as FencedRuntimeHostHandlerParams | null;
    const name = params?.name;
    if (
      !this.acceptsFrame(
        connection,
        params?.attachmentId,
        `hostHandler:${String(name)}`,
      )
    ) {
      throw new RpcError(
        RPC_ERROR_CODES.INVALID_PARAMS,
        `${RUNTIME_ATTACHMENT_STALE}: ${String(name)} was sent to a route this app no longer serves.`,
      );
    }
    const handler = isRuntimeHostHandler(name)
      ? this.options.hostHandlers[name]
      : undefined;
    if (!handler) {
      throw new RpcError(
        RPC_ERROR_CODES.METHOD_NOT_FOUND,
        `This app does not serve ${String(name)}.`,
      );
    }
    const args = Array.isArray(params?.args) ? params.args : [];
    return await (handler as (...args: unknown[]) => unknown)(...args);
  }
}

const isServerMismatch = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(RUNTIME_SERVER_MISMATCH);

