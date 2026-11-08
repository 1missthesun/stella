import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { Effect, Exit, type Scope } from "effect";
import {
  STELLA_RUNTIME_READY_METHOD,
  type RuntimeInitializeResult,
} from "@stella/contracts/protocol";
import { runtimeIpcPathUsesFilesystem } from "../../worker/runtime-paths.js";
import {
  describeRuntimeServerIdentityMismatch,
  parseRuntimeServerIdentity,
  type ExpectedRuntimeServerIdentity,
  type RuntimeServerIdentity,
} from "../../worker/server-identity.js";
import {
  createRuntimeAuthNonce,
  isRuntimeAuthNonce,
  runtimeClientProof,
  runtimeProofMatches,
  runtimeServerProof,
  STELLA_RUNTIME_AUTH_METHOD,
} from "../../worker/runtime-auth.js";
import { WorkerNotReadyError } from "./errors.js";

const WORKER_READY_PROBE_ID = "__stella_runtime_ready_probe__";
const MAX_PROBE_REPLY_BYTES = 64 * 1024;

export type ReadyProbeStatus =
  | "ready"
  | "version-mismatch"
  | "identity-mismatch"
  | "unavailable";

export type ReadyProbeResult = {
  status: ReadyProbeStatus;
  identity: RuntimeServerIdentity | null;
  mismatch?: string;
};

export type ReadySocketResult =
  | { status: "ready"; socket: Socket; identity: RuntimeServerIdentity | null }
  | { status: "version-mismatch" | "unavailable"; identity: RuntimeServerIdentity | null }
  | { status: "identity-mismatch"; identity: RuntimeServerIdentity | null; mismatch: string };

const unavailableProbe: ReadyProbeResult = {
  status: "unavailable",
  identity: null,
};

const connectSocket = (
  socketPath: string,
  timeoutMs: number,
): Effect.Effect<Socket, WorkerNotReadyError> =>
  Effect.suspend(() => {
    if (runtimeIpcPathUsesFilesystem(socketPath) && !existsSync(socketPath)) {
      return Effect.fail(new WorkerNotReadyError({ socketPath }));
    }
    return Effect.callback<Socket, WorkerNotReadyError>((resume) => {
      let socket: Socket;
      try {
        socket = createConnection(socketPath);
      } catch {
        resume(Effect.fail(new WorkerNotReadyError({ socketPath })));
        return;
      }
      let settled = false;
      const finish = (result: Socket | null) => {
        if (settled) return;
        settled = true;
        if (result == null) {
          try {
            socket.destroy();
          } catch {
            // ignore
          }
          resume(Effect.fail(new WorkerNotReadyError({ socketPath })));
          return;
        }
        resume(Effect.succeed(result));
      };
      socket.once("connect", () => {
        socket.setNoDelay(true);
        finish(socket);
      });
      socket.once("error", () => {
        finish(null);
      });
      return Effect.sync(() => {
        if (!settled) {
          settled = true;
          try {
            socket.destroy();
          } catch {
            // ignore
          }
        }
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.fail(new WorkerNotReadyError({ socketPath })),
      }),
    );
  });

const destroyQuietly = (socket: Socket) => {
  try {
    socket.destroy();
  } catch {
    // ignore
  }
};

const UNPROVEN_RUNTIME =
  "the runtime did not prove it holds this install's runtime auth key";

const authenticateWorker = (
  socket: Socket,
  timeoutMs: number,
  authKey: Buffer,
  expectedProtocolVersion?: string,
  expectedIdentity?: ExpectedRuntimeServerIdentity,
): Effect.Effect<ReadyProbeResult> =>
  Effect.callback<ReadyProbeResult>((resume) => {
    const clientNonce = createRuntimeAuthNonce();
    let buffer = "";
    let settled = false;
    const detach = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onError);
    };
    const finish = (result: ReadyProbeResult) => {
      if (settled) return;
      settled = true;
      detach();
      resume(Effect.succeed(result));
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        if (buffer.length > MAX_PROBE_REPLY_BYTES) finish(unavailableProbe);
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      const rest = buffer.slice(newlineIndex + 1);
      let message: { id?: unknown; result?: unknown; error?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        finish(unavailableProbe);
        return;
      }
      if (message.id !== WORKER_READY_PROBE_ID || message.error) {
        finish(unavailableProbe);
        return;
      }
      const result = message.result as
        | (Partial<RuntimeInitializeResult> & {
            identity?: unknown;
            serverNonce?: unknown;
            serverProof?: unknown;
          })
        | undefined;
      const identity = parseRuntimeServerIdentity(result?.identity);
      const serverNonce = result?.serverNonce;
      if (
        !identity ||
        !isRuntimeAuthNonce(serverNonce) ||
        !runtimeProofMatches(
          runtimeServerProof(authKey, { clientNonce, serverNonce }, identity),
          result?.serverProof,
        )
      ) {
        finish({
          status: "identity-mismatch",
          identity: null,
          mismatch: UNPROVEN_RUNTIME,
        });
        return;
      }
      if (
        expectedProtocolVersion &&
        result?.protocolVersion !== expectedProtocolVersion
      ) {
        finish({ status: "version-mismatch", identity });
        return;
      }
      const mismatch = expectedIdentity
        ? describeRuntimeServerIdentityMismatch(expectedIdentity, identity)
        : null;
      if (mismatch) {
        finish({ status: "identity-mismatch", identity, mismatch });
        return;
      }
      socket.write(
        `${JSON.stringify({
          method: STELLA_RUNTIME_AUTH_METHOD,
          params: {
            clientProof: runtimeClientProof(authKey, {
              clientNonce,
              serverNonce,
            }),
          },
        })}\n`,
      );
      socket.pause();
      if (rest) socket.unshift(Buffer.from(rest, "utf-8"));
      finish({ status: "ready", identity });
    };
    const onError = () => finish(unavailableProbe);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onError);
    socket.write(
      `${JSON.stringify({
        id: WORKER_READY_PROBE_ID,
        method: STELLA_RUNTIME_READY_METHOD,
        params: { clientNonce },
      })}\n`,
    );
    return Effect.sync(() => {
      settled = true;
      detach();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () => Effect.succeed(unavailableProbe),
    }),
  );

export const connectReadySocket = (
  socketPath: string,
  timeoutMs: number,
  authKey: Buffer,
  expectedProtocolVersion?: string,
  expectedIdentity?: ExpectedRuntimeServerIdentity,
): Effect.Effect<ReadySocketResult, never, Scope.Scope> =>
  Effect.gen(function* () {
    const attempt = yield* Effect.scoped(
      Effect.gen(function* () {
        let keep = false;
        const socket = yield* Effect.acquireRelease(
          connectSocket(socketPath, timeoutMs),
          (acquired) =>
            keep ? Effect.void : Effect.sync(() => destroyQuietly(acquired)),
        );
        const probed = yield* authenticateWorker(
          socket,
          timeoutMs,
          authKey,
          expectedProtocolVersion,
          expectedIdentity,
        );
        keep = probed.status === "ready";
        return { socket, probed };
      }),
    ).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!attempt) return { status: "unavailable", identity: null };
    const { socket, probed } = attempt;
    if (probed.status === "identity-mismatch") {
      return {
        status: "identity-mismatch",
        identity: probed.identity,
        mismatch: probed.mismatch ?? "identity mismatch",
      };
    }
    if (probed.status !== "ready") {
      return { status: probed.status, identity: probed.identity };
    }
    yield* Effect.addFinalizer((exit) =>
      Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => destroyQuietly(socket)),
    );
    return { status: "ready", socket, identity: probed.identity };
  });
