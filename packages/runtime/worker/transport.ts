import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { PassThrough } from "node:stream";
import { existsSync, promises as fsPromises } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { attachJsonRpcPeerToStreams } from "@stella/contracts/protocol/jsonl";
import {
  STELLA_RUNTIME_PROTOCOL_VERSION,
  STELLA_RUNTIME_READY_METHOD,
} from "@stella/contracts/protocol";
import type { JsonRpcPeer } from "@stella/contracts/protocol/rpc-peer";
import { workerRuntime } from "./effect-runtime.js";
import type { RuntimeServerIdentity } from "./server-identity.js";
import {
  ensurePrivateSocketDir,
  isWindowsNamedPipePath,
  runtimeIpcPathUsesFilesystem,
} from "./runtime-paths.js";
import {
  createRuntimeAuthNonce,
  isRuntimeAuthNonce,
  runtimeClientProof,
  runtimeProofMatches,
  runtimeServerProof,
  STELLA_RUNTIME_AUTH_METHOD,
  type RuntimeAuthNonces,
} from "./runtime-auth.js";

export type WorkerTransport =
  | { kind: "stdio" }
  | { kind: "unix"; socketPath: string }
  | { kind: "pipe"; socketPath: string };

export type WorkerTransportParseResult =
  | { ok: true; transport: WorkerTransport }
  | { ok: false; error: string };

export const DEFAULT_LISTEN_URL = "stdio://";

export const parseWorkerListenUrl = (
  listenUrl: string,
): WorkerTransportParseResult => {
  const normalized = listenUrl.trim();
  if (!normalized || normalized === DEFAULT_LISTEN_URL) {
    return { ok: true, transport: { kind: "stdio" } };
  }
  if (normalized.startsWith("unix://")) {
    const socketPath = normalized.slice("unix://".length).trim();
    if (!socketPath) {
      return {
        ok: false,
        error: "Missing socket path: --listen unix://PATH requires a path.",
      };
    }
    return {
      ok: true,
      transport: { kind: "unix", socketPath: path.resolve(socketPath) },
    };
  }
  if (normalized.startsWith("pipe://")) {
    const socketPath = normalized.slice("pipe://".length).trim();
    if (!socketPath) {
      return {
        ok: false,
        error: "Missing pipe path: --listen pipe://PIPE requires a path.",
      };
    }
    if (!isWindowsNamedPipePath(socketPath)) {
      return {
        ok: false,
        error:
          "Invalid Windows named pipe: --listen pipe://... expects \\\\.\\pipe\\NAME.",
      };
    }
    return {
      ok: true,
      transport: { kind: "pipe", socketPath },
    };
  }
  return {
    ok: false,
    error: `Unsupported --listen URL: ${listenUrl}; expected stdio://, unix://PATH, or pipe://PIPE.`,
  };
};

export type StartTransportArgs = {
  transport: WorkerTransport;
  attach: (peer: JsonRpcPeer) => void;
  protocolVersion?: string;
  identity?: RuntimeServerIdentity;
  authKey?: Buffer;
  onError?: (error: unknown) => void;
};

export type StartTransportResult = {
  close: () => Promise<void>;
  describe: () => string;
};

const startStdioTransport = (
  args: StartTransportArgs,
): StartTransportResult => {
  const handle = attachJsonRpcPeerToStreams({
    input: process.stdin,
    output: process.stdout,
    onError: args.onError,
  });
  args.attach(handle.peer);
  return {
    close: async () => {
      handle.dispose();
    },
    describe: () => "stdio",
  };
};

const probeSocketAlive = (socketPath: string): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    let socket: Socket;
    try {
      socket = createConnection(socketPath);
    } catch {
      resume(Effect.succeed(false));
      return;
    }
    let settled = false;
    const finish = (alive: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resume(Effect.succeed(alive));
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    return Effect.sync(() => {
      if (!settled) {
        settled = true;
        try {
          socket.destroy();
        } catch {
          // Best effort.
        }
      }
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: 250,
      orElse: () => Effect.succeed(false),
    }),
  );

const removeIfStaleSocket = async (socketPath: string) => {
  const usesFilesystem = runtimeIpcPathUsesFilesystem(socketPath);
  if (usesFilesystem && !existsSync(socketPath)) return;
  const liveSocket = await workerRuntime.runPromise(
    probeSocketAlive(socketPath),
  );
  if (liveSocket) {
    throw new Error(`Runtime socket is already in use: ${socketPath}`);
  }
  if (usesFilesystem) {
    await fsPromises.unlink(socketPath).catch(() => undefined);
  }
};

const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_HANDSHAKE_LINE_BYTES = 16 * 1024;

const parseHandshakeLine = (
  line: string,
): { id?: unknown; method?: unknown; params?: Record<string, unknown> } | null => {
  try {
    const message = JSON.parse(line) as unknown;
    return message && typeof message === "object"
      ? (message as { id?: unknown; method?: unknown; params?: Record<string, unknown> })
      : null;
  } catch {
    return null;
  }
};

const startIpcSocketTransport = async (
  args: StartTransportArgs & {
    transport:
      | { kind: "unix"; socketPath: string }
      | { kind: "pipe"; socketPath: string };
  },
): Promise<StartTransportResult> => {
  const { socketPath } = args.transport;
  const { authKey, identity } = args;
  if (!authKey || !identity) {
    throw new Error("A socket transport requires the runtime auth key and identity.");
  }
  const usesFilesystem = runtimeIpcPathUsesFilesystem(socketPath);
  if (usesFilesystem) {
    await ensurePrivateSocketDir(socketPath);
  }
  await removeIfStaleSocket(socketPath);

  const sockets = new Set<Socket>();
  const server: Server = createServer((socket: Socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {
      // Connection-level errors (e.g. host crashed) just close the socket;
      // peer.dispose runs via the readline 'close' handler downstream.
    });
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => socket.destroy());

    let buffered = "";
    let nonces: RuntimeAuthNonces | null = null;
    const attachSocket = (initialInput: string) => {
      socket.off("data", onHandshakeData);
      socket.setTimeout(0);
      socket.pause();
      const input = new PassThrough();
      if (initialInput) {
        input.write(initialInput);
      }
      socket.pipe(input);
      const handle = attachJsonRpcPeerToStreams({
        input,
        output: socket,
        onError: args.onError,
      });
      args.attach(handle.peer);
      socket.resume();
    };
    const reject = () => {
      socket.off("data", onHandshakeData);
      socket.destroy();
    };
    const onHandshakeData = (chunk: Buffer) => {
      buffered += chunk.toString("utf-8");
      for (;;) {
        const newlineIndex = buffered.indexOf("\n");
        if (newlineIndex < 0) {
          if (buffered.length > MAX_HANDSHAKE_LINE_BYTES) reject();
          return;
        }
        const message = parseHandshakeLine(buffered.slice(0, newlineIndex));
        buffered = buffered.slice(newlineIndex + 1);
        if (!nonces) {
          const clientNonce = message?.params?.clientNonce;
          if (
            message?.method !== STELLA_RUNTIME_READY_METHOD ||
            message.id === undefined ||
            !isRuntimeAuthNonce(clientNonce)
          ) {
            reject();
            return;
          }
          nonces = { clientNonce, serverNonce: createRuntimeAuthNonce() };
          socket.write(
            `${JSON.stringify({
              id: message.id,
              result: {
                ok: true,
                protocolVersion:
                  args.protocolVersion ?? STELLA_RUNTIME_PROTOCOL_VERSION,
                identity,
                serverNonce: nonces.serverNonce,
                serverProof: runtimeServerProof(authKey, nonces, identity),
              },
            })}\n`,
          );
          continue;
        }
        if (
          message?.method !== STELLA_RUNTIME_AUTH_METHOD ||
          !runtimeProofMatches(
            runtimeClientProof(authKey, nonces),
            message.params?.clientProof,
          )
        ) {
          reject();
          return;
        }
        attachSocket(buffered);
        return;
      }
    };
    socket.on("data", onHandshakeData);
  });

  server.on("error", (error) => {
    args.onError?.(error);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  if (usesFilesystem) {
    await fsPromises.chmod(socketPath, 0o600).catch(() => undefined);
  }

  return {
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) {
          socket.destroy();
        }
      });
      if (usesFilesystem) {
        await fsPromises.unlink(socketPath).catch(() => undefined);
      }
    },
    describe: () => `${args.transport.kind}://${socketPath}`,
  };
};

export const startWorkerTransport = async (
  args: StartTransportArgs,
): Promise<StartTransportResult> => {
  if (args.transport.kind === "stdio") {
    return startStdioTransport(args);
  }
  return await startIpcSocketTransport({
    ...args,
    transport: args.transport,
  });
};
