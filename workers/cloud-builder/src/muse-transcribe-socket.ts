import {
  forkAbortTimer,
  runToolEffect,
} from "@stella/runtime/kernel/tools/effect-runtime.js";
import * as Effect from "effect/Effect";
import { SUBPROTOCOL } from "./conversation-hub.js";
import { log } from "./build-session/shared/keys.js";

const MUSE_MODEL = "muse-voice-transcribe-1.0";
const MUSE_SOCKET_URL = "https://api.meta.ai/v1/asr/realtime";
const PCM_BYTES_PER_SECOND = 16_000 * 2;
const MAX_AUDIO_BYTES = 60 * 60 * PCM_BYTES_PER_SECOND;
const MAX_FRAME_BYTES = PCM_BYTES_PER_SECOND;

type MuseRelayEnv = Pick<Cloudflare.Env, "META_MODEL_API_KEY">;

export type PreparedSession = {
  sessionId: string;
  providerDeadlineAt: number;
  maxAudioBytes?: number;
};

export class DictationUsageError extends Error {}

export type MuseControl = {
  prepare(sessionId: string): Promise<PreparedSession>;
  settle(usage: {
    sessionId: string;
    audioBytes: number;
    durationMs: number;
    success: boolean;
  }): Promise<void>;
};

export const createMuseHandshake = (apiKey: string) => ({
  authorization: { accessToken: `Bearer ${apiKey}` },
  audioEncoding: "PCM_16KHZ" as const,
  model: MUSE_MODEL,
  mode: "PUSH_TO_TALK" as const,
  partialMode: "CUMULATIVE" as const,
  emitAudioProgress: false,
});

export const isMuseEndStreamFrame = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value) as { type?: unknown };
    return parsed.type === "endStream" && Object.keys(parsed).length === 1;
  } catch {
    return false;
  }
};

const trySend = (socket: WebSocket, data: ArrayBuffer | string): boolean => {
  try {
    socket.send(data);
    return true;
  } catch {
    return false;
  }
};

const closeSocket = (socket: WebSocket, code: number, reason: string): void => {
  try {
    const validCode =
      code === 1000 ||
      code === 1001 ||
      code === 1002 ||
      code === 1003 ||
      (code >= 1007 && code <= 1014) ||
      (code >= 3000 && code <= 4999)
        ? code
        : 1011;
    socket.close(validCode, reason.slice(0, 120));
  } catch {
    // Closing is best effort once the peer has already gone away.
  }
};

type MuseRelayArgs = {
  request: Request;
  env: MuseRelayEnv;
  control: MuseControl;
  waitUntil: (promise: Promise<unknown>) => void;
  timing?: { requestId: string; receivedAt: number; authMs: number };
};

type StartupTiming = {
  fields: Record<string, number | string>;
  startedAt: number;
  lap: (name: string) => void;
};

const startupTiming = (args: MuseRelayArgs, startedAt: number): StartupTiming => {
  const fields: Record<string, number | string> = {
    requestId: args.timing?.requestId ?? "",
    authMs: args.timing?.authMs ?? 0,
  };
  let phaseStart = Date.now();
  return {
    fields,
    startedAt,
    lap: (name) => {
      const at = Date.now();
      fields[name] = at - phaseStart;
      phaseStart = at;
    },
  };
};

type EarlyUpstreamFrame = { data: ArrayBuffer | string; at: number };

type ProviderStart =
  | {
      ok: true;
      prepared: PreparedSession;
      upstream: WebSocket;
      reportUsage: (
        audioBytes: number,
        durationMs: number,
        success: boolean,
      ) => Promise<void>;
      handshakeSentAt: number;
      early: EarlyUpstreamFrame[];
      detach: () => void;
    }
  | { ok: false; usageMessage?: string; status: number; message: string };

const startProvider = async (
  args: MuseRelayArgs,
  apiKey: string,
  timing: StartupTiming,
): Promise<ProviderStart> => {
  const sessionId = `muse_${crypto.randomUUID()}`;
  const upstreamUrl = new URL(MUSE_SOCKET_URL);
  upstreamUrl.searchParams.set("sessionId", sessionId);
  let prepareFailed = false;
  let upstreamClosed = false;
  let handshakeSentAt = 0;
  const early: EarlyUpstreamFrame[] = [];
  const onEarlyMessage = (event: MessageEvent) => {
    early.push({ data: event.data as ArrayBuffer | string, at: Date.now() });
  };
  const onEarlyClose = () => {
    upstreamClosed = true;
  };
  // Aborting a fetch after its 101 response also disconnects the upgraded
  // socket. Bound only the upgrade; the session has its own deadline below.
  const upstreamReady = runToolEffect(
    Effect.tryPromise((signal) =>
      fetch(upstreamUrl, {
        headers: { Upgrade: "websocket" },
        signal,
      }),
    ).pipe(Effect.timeout(10_000)),
  )
    .catch(() => null)
    .then((response) => {
      const socket =
        response?.status === 101 ? (response.webSocket ?? null) : null;
      if (!socket) return { response, socket: null };
      socket.accept();
      if (prepareFailed) {
        closeSocket(socket, 1000, "Dictation not started");
        return { response, socket: null };
      }
      socket.addEventListener("message", onEarlyMessage);
      socket.addEventListener("close", onEarlyClose);
      socket.addEventListener("error", onEarlyClose);
      if (!trySend(socket, JSON.stringify(createMuseHandshake(apiKey)))) {
        closeSocket(socket, 1011, "Muse handshake failed");
        return { response, socket: null };
      }
      handshakeSentAt = Date.now();
      return { response, socket };
    });
  const discardUpstream = () => {
    prepareFailed = true;
    args.waitUntil(
      upstreamReady.then(async ({ response, socket }) => {
        if (socket) closeSocket(socket, 1000, "Dictation not started");
        else if (!response?.webSocket)
          await response?.body?.cancel().catch(() => undefined);
      }),
    );
  };

  let prepared: PreparedSession;
  try {
    prepared = await args.control.prepare(sessionId);
  } catch (error) {
    discardUpstream();
    if (error instanceof DictationUsageError) {
      return {
        ok: false,
        usageMessage: error.message,
        status: 429,
        message: error.message,
      };
    }
    return {
      ok: false,
      status: 503,
      message: "Muse transcription is unavailable.",
    };
  }

  timing.lap("prepareMs");
  if (
    !Number.isFinite(prepared.providerDeadlineAt) ||
    prepared.providerDeadlineAt <= Date.now()
  ) {
    discardUpstream();
    return {
      ok: false,
      status: 503,
      message: "Muse transcription session expired.",
    };
  }
  const reportUsage = async (
    audioBytes: number,
    durationMs: number,
    success: boolean,
  ) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await args.control.settle({
          sessionId: prepared.sessionId,
          audioBytes,
          durationMs,
          success,
        });
        return;
      } catch {
        // If all attempts fail, the session goes unbilled.
      }
    }
  };
  const { response: upstreamResponse, socket: upstream } = await upstreamReady;
  timing.lap("upstreamUpgradeMs");
  if (!upstream || upstreamClosed) {
    if (upstream) closeSocket(upstream, 1011, "Muse transcription failed");
    else await upstreamResponse?.body?.cancel().catch(() => undefined);
    args.waitUntil(reportUsage(0, 0, false));
    return {
      ok: false,
      status: 502,
      message: "Muse transcription is unavailable.",
    };
  }
  return {
    ok: true,
    prepared,
    upstream,
    reportUsage,
    handshakeSentAt,
    early,
    detach: () => {
      upstream.removeEventListener("message", onEarlyMessage);
      upstream.removeEventListener("close", onEarlyClose);
      upstream.removeEventListener("error", onEarlyClose);
    },
  };
};

const bridge = (
  args: MuseRelayArgs,
  gateway: WebSocket,
  start: Extract<ProviderStart, { ok: true }>,
  timing: StartupTiming,
  pending: readonly (ArrayBuffer | string)[] = [],
): void => {
  const { prepared, upstream, reportUsage } = start;
  let audioBytes = 0;
  let settled = false;
  let closing = false;
  let inputEnded = false;
  let cancelDeadline: (() => void) | undefined;
  let sawFinalTranscript = false;
  let sawUpstreamError = false;
  const startedAt = Date.now();
  const settle = (success: boolean): void => {
    if (settled) return;
    settled = true;
    cancelDeadline?.();
    args.waitUntil(reportUsage(audioBytes, Date.now() - startedAt, success));
  };

  const closeBoth = (code: number, reason: string) => {
    closing = true;
    closeSocket(upstream, code, reason);
    closeSocket(gateway, code, reason);
  };
  const endInput = () => {
    if (inputEnded || closing || settled) return;
    inputEnded = true;
    cancelDeadline?.();
    if (!trySend(upstream, JSON.stringify({ type: "endStream" }))) {
      closeBoth(1011, "Muse transcription failed");
      return;
    }
    cancelDeadline = forkAbortTimer(10_000, () => {
      closeBoth(1011, "Transcription took too long to finish");
    });
  };
  cancelDeadline = forkAbortTimer(
    Math.max(0, prepared.providerDeadlineAt - Date.now()),
    endInput,
  );
  const maxAudioBytes = Math.min(
    MAX_AUDIO_BYTES,
    prepared.maxAudioBytes ?? MAX_AUDIO_BYTES,
  );

  const onClientFrame = (data: ArrayBuffer | string) => {
    if (settled || closing || inputEnded) return;
    if (Date.now() >= prepared.providerDeadlineAt) {
      endInput();
      return;
    }
    if (data instanceof ArrayBuffer) {
      if (data.byteLength === 0 || data.byteLength > MAX_FRAME_BYTES) {
        closeBoth(1008, "Invalid audio frame");
        return;
      }
      const frame = data.slice(0, maxAudioBytes - audioBytes);
      audioBytes += frame.byteLength;
      if (!trySend(upstream, frame)) {
        closeBoth(1011, "Muse transcription failed");
        return;
      }
      if (audioBytes === maxAudioBytes) endInput();
      return;
    }
    if (isMuseEndStreamFrame(data)) {
      endInput();
      return;
    }
    closeBoth(1008, "Invalid transcription frame");
  };
  gateway.addEventListener("message", (event) =>
    onClientFrame(event.data as ArrayBuffer | string),
  );
  let awaitingAck = true;
  const onUpstreamFrame = (data: ArrayBuffer | string, at = Date.now()) => {
    if (awaitingAck) {
      awaitingAck = false;
      timing.fields.handshakeAckMs = at - start.handshakeSentAt;
      timing.fields.totalToAckMs = at - timing.startedAt;
      log("info", "dictation_socket_timing", timing.fields);
    }
    if (settled || closing) return;
    if (typeof data === "string") {
      try {
        const frame = JSON.parse(data) as {
          type?: unknown;
          final?: unknown;
        };
        if (frame.type === "error") sawUpstreamError = true;
        if (frame.type === "transcript" && frame.final === true) {
          sawFinalTranscript = true;
        }
      } catch {
        // Forward provider frames unchanged; clients ignore unknown payloads.
      }
    }
    if (!trySend(gateway, data)) closeBoth(1001, "Client went away");
  };
  start.detach();
  upstream.addEventListener("message", (event) =>
    onUpstreamFrame(event.data as ArrayBuffer | string),
  );
  upstream.addEventListener("close", (event) => {
    settle(
      !closing &&
        !sawUpstreamError &&
        (event.code === 1000 || sawFinalTranscript),
    );
    closeSocket(gateway, event.code, event.reason);
  });
  upstream.addEventListener("error", () => {
    closeBoth(1011, "Muse transcription failed");
    settle(false);
  });
  gateway.addEventListener("close", (event) => {
    closing = true;
    closeSocket(upstream, event.code, event.reason);
  });

  for (const frame of start.early.splice(0)) onUpstreamFrame(frame.data, frame.at);
  for (const frame of pending) onClientFrame(frame);
};

const acceptClientSocket = () => {
  const pair = new WebSocketPair();
  const gateway = pair[1];
  // Current Workers compatibility dates deliver binary frames as Blob by
  // default. Keep PCM frames synchronous and ordered for the relay.
  gateway.binaryType = "arraybuffer";
  gateway.accept();
  return {
    gateway,
    response: new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { "sec-websocket-protocol": SUBPROTOCOL },
    }),
  };
};

const DEFERRED_START_IDLE_MS = 60_000;
const DEFERRED_START_MAX_PENDING_BYTES = 8 * PCM_BYTES_PER_SECOND;

const isStartFrame = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try {
    const parsed = JSON.parse(value) as { type?: unknown };
    return parsed.type === "start" && Object.keys(parsed).length === 1;
  } catch {
    return false;
  }
};

const handleDeferredStart = (
  args: MuseRelayArgs,
  apiKey: string,
): Response => {
  const { gateway, response } = acceptClientSocket();
  let phase: "idle" | "starting" | "live" | "closed" = "idle";
  const pending: (ArrayBuffer | string)[] = [];
  let pendingBytes = 0;
  const cancelIdle = forkAbortTimer(DEFERRED_START_IDLE_MS, () => {
    if (phase === "idle") closeSocket(gateway, 1000, "Dictation idle");
  });

  const run = async () => {
    const timing = startupTiming(args, Date.now());
    timing.fields.deferred = 1;
    const start = await startProvider(args, apiKey, timing);
    if (!start.ok) {
      if (phase === "closed") return;
      phase = "closed";
      trySend(
        gateway,
        JSON.stringify({
          type: "error",
          message: start.usageMessage ?? start.message,
        }),
      );
      closeSocket(
        gateway,
        start.usageMessage ? 1008 : 1011,
        start.usageMessage
          ? "Dictation usage limit reached"
          : "Muse transcription is unavailable",
      );
      return;
    }
    if (phase === "closed") {
      closeSocket(start.upstream, 1000, "Dictation cancelled");
      args.waitUntil(start.reportUsage(0, 0, false));
      return;
    }
    phase = "live";
    gateway.removeEventListener("message", onPreStartFrame);
    bridge(args, gateway, start, timing, pending.splice(0));
  };

  const onPreStartFrame = (event: MessageEvent) => {
    if (phase === "idle") {
      if (!isStartFrame(event.data)) {
        phase = "closed";
        closeSocket(gateway, 1008, "Send start first");
        return;
      }
      phase = "starting";
      cancelIdle();
      args.waitUntil(run());
      return;
    }
    if (phase !== "starting") return;
    const data = event.data as ArrayBuffer | string;
    pendingBytes += typeof data === "string" ? data.length : data.byteLength;
    if (pendingBytes > DEFERRED_START_MAX_PENDING_BYTES) {
      phase = "closed";
      closeSocket(gateway, 1011, "Transcription took too long to start");
      return;
    }
    pending.push(data);
  };
  gateway.addEventListener("message", onPreStartFrame);
  gateway.addEventListener("close", () => {
    cancelIdle();
    if (phase !== "live") phase = "closed";
  });
  return response;
};

export const handleMuseTranscribeSocket = async (
  args: MuseRelayArgs,
): Promise<Response> => {
  const apiKey = args.env.META_MODEL_API_KEY?.trim();
  if (!apiKey)
    return new Response("Muse transcription is unavailable.", { status: 503 });

  if (new URL(args.request.url).searchParams.get("start") === "deferred") {
    return handleDeferredStart(args, apiKey);
  }

  const timing = startupTiming(args, args.timing?.receivedAt ?? Date.now());
  const start = await startProvider(args, apiKey, timing);
  if (!start.ok) {
    if (start.usageMessage) {
      const { gateway, response } = acceptClientSocket();
      trySend(gateway, JSON.stringify({ type: "error", message: start.usageMessage }));
      gateway.close(1008, "Dictation usage limit reached");
      return response;
    }
    return new Response(start.message, { status: start.status });
  }
  const { gateway, response } = acceptClientSocket();
  bridge(args, gateway, start, timing);
  return response;
};
