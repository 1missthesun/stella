import { getAuthToken } from "./auth-token";
import { socketCredentialProtocol } from "@stella/contracts/socket-ticket";
import { getBackendClient } from "./backend";

const MAX_PCM_FRAME_BYTES = 16_000 * 2;

type RealtimeConfig = { relayOrigin: string; modelId: string };

const CONFIG_TTL_MS = 10 * 60_000;
let cachedConfig: { value: Promise<RealtimeConfig>; at: number } | null = null;

export const loadDictationRealtimeConfig = (): Promise<RealtimeConfig> => {
  if (cachedConfig && Date.now() - cachedConfig.at < CONFIG_TTL_MS) {
    return cachedConfig.value;
  }
  const entry = {
    value: getBackendClient().call("dictation.realtimeConfig", {}),
    at: Date.now(),
  };
  cachedConfig = entry;
  entry.value.catch(() => {
    if (cachedConfig === entry) cachedConfig = null;
  });
  return entry.value;
};

export const describeDictationProviderError = (message: string): string => {
  const trimmed = message.trim();
  if (/slower than real[- ]?time|ingress/iu.test(trimmed)) {
    return "Audio stopped reaching the transcription service in time.";
  }
  return trimmed || "Dictation failed.";
};
const WARM_SOCKET_TTL_MS = 50_000;
const OPEN_TIMEOUT_MS = 10_000;

const connectRelay = async (): Promise<WebSocket> => {
  const [config, token] = await Promise.all([
    loadDictationRealtimeConfig(),
    getAuthToken(),
  ]);
  if (!token) throw new Error("Sign in to Stella to use dictation.");
  const url = new URL("/dictation/socket", config.relayOrigin);
  url.searchParams.set("start", "deferred");
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  const credential = await socketCredentialProtocol({
    socketUrl: url.toString(),
    token,
    purpose: "dictation",
  });
  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url.toString(), ["stella.v1", credential]);
    socket.binaryType = "arraybuffer";
    const settle = (error: Error | null) => {
      clearTimeout(timer);
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      if (!error) {
        resolve(socket);
        return;
      }
      try {
        socket.close();
      } catch {
        /* The peer may already be gone. */
      }
      reject(error);
    };
    const timer = setTimeout(() => {
      settle(new Error("Dictation took too long to connect."));
    }, OPEN_TIMEOUT_MS);
    socket.onopen = () => settle(null);
    socket.onerror = () => settle(new Error("Could not connect to dictation."));
    socket.onclose = () => settle(new Error("Could not connect to dictation."));
  });
};

let warmSocket: { socket: Promise<WebSocket>; expiresAt: number } | null =
  null;

const closeQuietly = (socket: WebSocket, reason: string) => {
  socket.onclose = null;
  try {
    socket.close(1000, reason);
  } catch {
    /* Already closed. */
  }
};

export const warmDictationSocket = (): void => {
  if (warmSocket && Date.now() < warmSocket.expiresAt - 5_000) return;
  releaseWarmDictationSocket();
  const entry = {
    socket: connectRelay(),
    expiresAt: Date.now() + WARM_SOCKET_TTL_MS,
  };
  warmSocket = entry;
  entry.socket.then(
    (socket) => {
      if (warmSocket !== entry) {
        closeQuietly(socket, "Dictation idle");
        return;
      }
      socket.onclose = () => {
        if (warmSocket === entry) warmSocket = null;
      };
      setTimeout(() => {
        if (warmSocket !== entry) return;
        warmSocket = null;
        closeQuietly(socket, "Dictation idle");
      }, Math.max(0, entry.expiresAt - Date.now()));
    },
    () => {
      if (warmSocket === entry) warmSocket = null;
    },
  );
};

export const releaseWarmDictationSocket = (): void => {
  const entry = warmSocket;
  warmSocket = null;
  void entry?.socket.then(
    (socket) => closeQuietly(socket, "Dictation idle"),
    () => undefined,
  );
};

const takeWarmSocket = (): Promise<WebSocket> | null => {
  const entry = warmSocket;
  warmSocket = null;
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    void entry.socket.then(
      (socket) => closeQuietly(socket, "Dictation idle"),
      () => undefined,
    );
    return null;
  }
  return entry.socket.then(
    (socket) => {
      socket.onclose = null;
      return socket.readyState === WebSocket.OPEN ? socket : connectRelay();
    },
    () => connectRelay(),
  );
};

type TranscriptFrame = {
  type?: unknown;
  sessionId?: unknown;
  transcript?: unknown;
  text?: unknown;
  final?: unknown;
  message?: unknown;
};

export class DictationStream {
  private socket: WebSocket | null = null;
  private transcript = "";
  private finalTranscript = "";
  private hasFinalTranscript = false;
  private streamError: Error | null = null;
  private cancelled = false;
  private rejectOpening: ((error: Error) => void) | null = null;
  private rejectFinishing: ((error: Error) => void) | null = null;

  constructor(
    private readonly onFailure?: (error: Error) => void,
    private readonly onFinal?: () => void,
  ) {}

  get isComplete(): boolean {
    return this.hasFinalTranscript;
  }

  get failure(): Error | null {
    return this.streamError;
  }

  get partialTranscript(): string {
    return this.hasFinalTranscript ? this.finalTranscript : this.transcript;
  }

  throwIfFailed(): void {
    if (this.streamError) throw this.streamError;
    if (this.cancelled) throw new Error("Dictation cancelled.");
  }

  private fail(error: Error): void {
    if (this.cancelled || this.streamError || this.hasFinalTranscript) return;
    this.streamError = error;
    if (this.rejectOpening) this.rejectOpening(error);
    else if (this.rejectFinishing) this.rejectFinishing(error);
    else this.onFailure?.(error);
  }

  async open(): Promise<void> {
    if (this.cancelled) throw new Error("Dictation cancelled.");
    const socket = await (takeWarmSocket() ?? connectRelay());
    if (this.cancelled) {
      try {
        socket.close(1000, "Cancelled");
      } catch {
        /* Already closed. */
      }
      throw new Error("Dictation cancelled.");
    }
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const failOpening = (error: Error) => {
        clearTimeout(timer);
        this.rejectOpening = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        if (this.socket === socket) this.socket = null;
        try {
          socket.close();
        } catch {
          /* The peer may already be gone. */
        }
        reject(error);
      };
      const timer = setTimeout(() => {
        failOpening(new Error("Dictation took too long to connect."));
      }, 10_000);
      this.rejectOpening = failOpening;
      socket.onopen = null;
      socket.onerror = () => {
        this.fail(
          new Error(
            this.rejectOpening
              ? "Could not connect to dictation."
              : "Dictation disconnected.",
          ),
        );
      };
      socket.onclose = () => {
        this.fail(
          new Error(
            this.rejectOpening
              ? "Could not connect to dictation."
              : "Dictation disconnected.",
          ),
        );
      };
      socket.onmessage = (event) => {
        if (
          this.cancelled ||
          this.streamError ||
          this.hasFinalTranscript ||
          this.socket !== socket
        )
          return;
        if (typeof event.data !== "string") return;
        let frame: TranscriptFrame;
        try {
          frame = JSON.parse(event.data) as TranscriptFrame;
        } catch {
          return;
        }
        if (
          frame.type === undefined &&
          typeof frame.sessionId === "string" &&
          frame.sessionId.trim() &&
          this.rejectOpening
        ) {
          clearTimeout(timer);
          this.rejectOpening = null;
          resolve();
        } else if (frame.type === "transcript") {
          if (this.rejectOpening) return;
          const transcript =
            typeof frame.transcript === "string"
              ? frame.transcript
              : typeof frame.text === "string"
                ? frame.text
                : this.transcript;
          this.transcript = transcript;
          if (frame.final === true) {
            this.finalTranscript = transcript;
            this.hasFinalTranscript = true;
            if (!this.cancelled && this.socket === socket) this.onFinal?.();
          }
        } else if (frame.type === "error") {
          this.fail(
            new Error(
              describeDictationProviderError(
                typeof frame.message === "string" ? frame.message : "",
              ),
            ),
          );
        }
      };
      try {
        socket.send(JSON.stringify({ type: "start" }));
      } catch {
        failOpening(new Error("Could not connect to dictation."));
      }
    });
  }

  send(bytes: ArrayBuffer): void {
    const socket = this.socket;
    if (
      this.cancelled ||
      this.streamError ||
      this.hasFinalTranscript ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      bytes.byteLength === 0
    )
      return;
    if (bytes.byteLength % 2 !== 0) {
      this.fail(new Error("The microphone returned invalid audio."));
      return;
    }
    try {
      for (
        let offset = 0;
        offset < bytes.byteLength;
        offset += MAX_PCM_FRAME_BYTES
      ) {
        socket.send(
          bytes.byteLength <= MAX_PCM_FRAME_BYTES
            ? bytes
            : bytes.slice(offset, offset + MAX_PCM_FRAME_BYTES),
        );
      }
    } catch {
      this.fail(new Error("Could not send dictation audio."));
    }
  }

  async finish(): Promise<string> {
    this.throwIfFailed();
    const socket = this.socket;
    if (this.hasFinalTranscript) {
      this.socket = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          /* Already closed by the relay. */
        }
      }
      return this.finalTranscript.trim();
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Dictation is not connected.");
    }
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const complete = (error: Error | null, text = "") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.rejectFinishing = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        if (this.socket === socket) this.socket = null;
        try {
          socket.close();
        } catch {
          /* Settlement must still complete. */
        }
        if (error) reject(error);
        else resolve(text);
      };
      const timer = setTimeout(() => {
        complete(new Error("Dictation took too long to finish."));
      }, 15_000);
      this.rejectFinishing = (error) => complete(error);
      socket.onclose = (event) => {
        if (this.streamError) complete(this.streamError);
        else if (event.code === 1000 || this.hasFinalTranscript) {
          complete(
            null,
            (this.hasFinalTranscript ? this.finalTranscript : this.transcript).trim(),
          );
        } else {
          complete(new Error(event.reason || "Dictation disconnected."));
        }
      };
      socket.onerror = () => this.fail(new Error("Dictation failed."));
      try {
        socket.send(JSON.stringify({ type: "endStream" }));
      } catch {
        complete(new Error("Dictation disconnected."));
      }
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.rejectOpening?.(new Error("Dictation cancelled."));
    this.rejectFinishing?.(new Error("Dictation cancelled."));
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
    }
    try {
      this.socket?.close(1000, "Cancelled");
    } catch {
      /* Best effort. */
    }
    this.socket = null;
  }
}
