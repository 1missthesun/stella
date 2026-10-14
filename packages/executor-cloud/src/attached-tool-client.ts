import { connect, type Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  ATTACHED_TOOL_PROTOCOL_VERSION,
  ATTACHED_TOOL_REQUEST_MAX_BYTES,
  ATTACHED_TOOL_RESPONSE_MAX_BYTES,
  AttachedToolProtocolError,
  type AttachedToolControlResponse,
  type AttachedToolResponse,
  decodeAttachedToolFrame,
  encodeAttachedToolFrame,
  parseAttachedToolControlResponse,
  parseAttachedToolResponse,
} from "./attached-tool-protocol.js";

export const attachedToolClientFailure = (
  request: unknown,
  message: string,
): AttachedToolControlResponse | AttachedToolResponse => {
  const isControl =
    Boolean(request) &&
    typeof request === "object" &&
    "control" in (request as Record<string, unknown>);
  const error =
    message.slice(0, 8_000) || "The attached tool host is unreachable.";
  return isControl
    ? { version: ATTACHED_TOOL_PROTOCOL_VERSION, status: "failed", error }
    : {
        version: ATTACHED_TOOL_PROTOCOL_VERSION,
        status: "failed",
        toolCallId: toolCallIdOf(request),
        fingerprint: fingerprintOf(request),
        error,
      };
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export type AttachedToolClientPaths = Readonly<{
  socketPath: string;
  requestPath: string;
  resultPath: string;
}>;

export const attachedToolClientPaths = (
  argv: readonly string[],
): AttachedToolClientPaths => {
  const flag = (name: string): string => {
    const index = argv.indexOf(name);
    const value = index >= 0 ? argv[index + 1] : undefined;
    if (!value || !path.isAbsolute(value) || value.includes("\u0000")) {
      throw new Error(`Attached tool client requires ${name}.`);
    }
    return value;
  };
  return {
    socketPath: flag("--socket"),
    requestPath: flag("--request"),
    resultPath: flag("--result"),
  };
};

const roundTrip = (socketPath: string, frame: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let buffered = "";
    let settled = false;
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      outcome();
    };
    const socket: Socket = connect(socketPath, () => {
      socket.write(`${encodeAttachedToolFrame(frame)}\n`, (error) => {
        if (error) finish(() => reject(error));
      });
    });
    socket.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (
        Buffer.byteLength(buffered, "utf8") > ATTACHED_TOOL_RESPONSE_MAX_BYTES
      ) {
        finish(() => reject(new AttachedToolProtocolError("frame")));
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      const line = buffered.slice(0, newline);
      finish(() => {
        try {
          resolve(
            decodeAttachedToolFrame(line, ATTACHED_TOOL_RESPONSE_MAX_BYTES),
          );
        } catch (error) {
          reject(asError(error));
        }
      });
    });
    socket.on("error", (error) => finish(() => reject(error)));
    socket.on("end", () =>
      finish(() => reject(new AttachedToolProtocolError("frame"))),
    );
  });

export const runAttachedToolClient = (
  paths: AttachedToolClientPaths,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const request = yield* Effect.tryPromise({
      try: async () =>
        decodeAttachedToolFrame(
          await readFile(paths.requestPath, "utf8"),
          ATTACHED_TOOL_REQUEST_MAX_BYTES,
        ),
      catch: asError,
    });
    const isControl =
      Boolean(request) &&
      typeof request === "object" &&
      "control" in (request as Record<string, unknown>);
    const answer = yield* Effect.tryPromise({
      try: async () => {
        const frame = await roundTrip(paths.socketPath, request);
        return isControl
          ? parseAttachedToolControlResponse(frame)
          : parseAttachedToolResponse(frame);
      },
      catch: asError,
    }).pipe(
      Effect.catch((error: Error) =>
        Effect.succeed(attachedToolClientFailure(request, error.message)),
      ),
    );
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(path.dirname(paths.resultPath), {
          mode: 0o700,
          recursive: true,
        });
        await writeFile(
          paths.resultPath,
          `${encodeAttachedToolFrame(answer)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
      },
      catch: asError,
    });
  });

const FINGERPRINT = /^[0-9a-f]{64}$/u;

const toolCallIdOf = (request: unknown): string => {
  const value = (request as Record<string, unknown> | null)?.toolCallId;
  return typeof value === "string" && value.length > 0 && value.length <= 256
    ? value
    : "unknown";
};

const fingerprintOf = (request: unknown): string => {
  const value = (request as Record<string, unknown> | null)?.fingerprint;
  return typeof value === "string" && FINGERPRINT.test(value)
    ? value
    : "0".repeat(64);
};
