import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Alert } from "react-native";
import { VOICE_TTS_STREAM_CANCEL_PATH } from "@stella/contracts/backend/voice";
import type { BackendError } from "@stella/contracts/backend/protocol";
import { REQUEST_BUDGET_MS, withDeadline } from "@stella/contracts/request-deadline";
import { getAuthToken } from "./auth-token";
import { getBackendClient } from "./backend";
import { fetchWithinDeadline } from "./cloud-request";
import { backendOrigin } from "./http";
import { createPlaybackSessionHold } from "./mobile-audio-session";
import { disposeAudioPlayer } from "./audio-player-disposal";

const READ_ALOUD_KEY = "stella-mobile.read-aloud-enabled";
const STREAM_START_TIMEOUT_MS = 8000;
const PLAYLIST_READY_TIMEOUT_MS = 20_000;
const PLAYLIST_READY_POLL_MS = 250;
const HLS_MAX_RECOVER_ATTEMPTS = 4;
const HLS_MAX_START_RETRIES = 3;
const HLS_RECOVER_BACKOFF_MS = 700;
const HLS_START_RETRY_BACKOFF_MS = 500;
const HLS_STALL_TIMEOUT_MS = 6000;
const HLS_WATCHDOG_INTERVAL_MS = 1500;
const HLS_PREMATURE_EPS_SEC = 1.5;

let cachedReadAloudEnabled = false;
const listeners = new Set<() => void>();
let currentPlayer: AudioPlayer | null = null;
let currentStreamTicket: string | null = null;
let playbackGeneration = 0;
let hlsWatchdog: ReturnType<typeof setInterval> | null = null;
const clearHlsWatchdog = () => {
  if (hlsWatchdog) {
    clearInterval(hlsWatchdog);
    hlsWatchdog = null;
  }
};
let hlsResume: {
  uri: string;
  id: string | null;
  at: number;
} | null = null;

const emit = () => {
  for (const listener of listeners) listener();
};

export type ReadAloudStatus = "loading" | "playing" | "paused";
export type ReadAloudState = {
  messageId: string | null;
  status: ReadAloudStatus;
};

let playbackState: ReadAloudState | null = null;

const playbackSession = createPlaybackSessionHold();
let playbackAbort: AbortController | null = null;

const abortPlaybackWork = () => {
  playbackAbort?.abort();
  playbackAbort = null;
};

const beginPlaybackWork = (): AbortSignal => {
  abortPlaybackWork();
  const controller = new AbortController();
  playbackAbort = controller;
  return controller.signal;
};

const speakingListeners = new Set<() => void>();
const emitSpeaking = () => {
  for (const listener of speakingListeners) listener();
};
const setPlaybackState = (next: ReadAloudState | null) => {
  if (
    playbackState === next ||
    (playbackState != null &&
      next != null &&
      playbackState.messageId === next.messageId &&
      playbackState.status === next.status)
  ) {
    return;
  }
  playbackState = next;
  emitSpeaking();
};

const speakingStore = {
  subscribe(listener: () => void) {
    speakingListeners.add(listener);
    return () => {
      speakingListeners.delete(listener);
    };
  },
  getSnapshot() {
    return playbackState;
  },
};

export function getReadAloudPlaybackState() {
  return playbackState;
}

export function useReadAloudState() {
  return useSyncExternalStore(
    speakingStore.subscribe,
    speakingStore.getSnapshot,
    speakingStore.getSnapshot,
  );
}

export const readAloudStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot() {
    return cachedReadAloudEnabled;
  },
};

export async function loadReadAloudPreference() {
  const raw = await AsyncStorage.getItem(READ_ALOUD_KEY);
  cachedReadAloudEnabled = raw === "1";
  emit();
  return cachedReadAloudEnabled;
}

export async function setReadAloudEnabled(enabled: boolean) {
  cachedReadAloudEnabled = enabled;
  emit();
  if (enabled) {
    await AsyncStorage.setItem(READ_ALOUD_KEY, "1");
  } else {
    await AsyncStorage.removeItem(READ_ALOUD_KEY);
    stopReadAloud();
  }
}

const stripForSpeech = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_>~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function prepareReadAloudStream(
  text: string,
  signal: AbortSignal,
): Promise<{ ticket: string; uri: string }> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const prepared = await getBackendClient().call("tts.prepare", { text });
  return { ticket: prepared.ticket, uri: `${backendOrigin()}${prepared.playlistPath}` };
}

function cancelStreamSession(ticket: string) {
  void (async () => {
    try {
      await withDeadline(
        { label: "Stopping read-aloud", timeoutMs: REQUEST_BUDGET_MS.call },
        async (signal) =>
          await fetch(`${backendOrigin()}${VOICE_TTS_STREAM_CANCEL_PATH}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${await getAuthToken()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ticket }),
            signal,
          }),
      );
    } catch {
      /* ignore */
    }
  })();
}

export function stopReadAloud() {
  playbackGeneration += 1;
  abortPlaybackWork();
  disposeHlsPlayback?.();
  clearHlsWatchdog();
  hlsResume = null;
  setPlaybackState(null);
  const ticket = currentStreamTicket;
  currentStreamTicket = null;
  if (ticket) cancelStreamSession(ticket);
  const player = currentPlayer;
  currentPlayer = null;
  if (player) disposeAudioPlayer(player);
  playbackSession.release();
}

export function stopReadAloudForDictation() {
  stopReadAloud();
}

export async function startAfterStoppingReadAloud<T>(
  start: () => T | Promise<T>,
): Promise<T> {
  stopReadAloudForDictation();
  return await start();
}

export function pauseReadAloud() {
  if (!currentPlayer || playbackState?.status !== "playing") return;
  try {
    currentPlayer.pause();
  } catch {
    /* ignore */
  }
  playbackSession.release();
  setPlaybackState({ messageId: playbackState.messageId, status: "paused" });
}

export function resumeReadAloud() {
  if (playbackState?.status !== "paused") return;
  if (!currentPlayer && hlsResume) {
    const resume = hlsResume;
    hlsResume = null;
    const id = playbackState.messageId;
    const generation = playbackGeneration;
    setPlaybackState({ messageId: id, status: "loading" });
    void playHlsResilient(resume.uri, id, generation, resume.at);
    return;
  }
  if (!currentPlayer || !playbackSession.hold()) return;
  try {
    currentPlayer.play();
  } catch {
    /* ignore */
  }
  setPlaybackState({ messageId: playbackState.messageId, status: "playing" });
}

export type PreparedSpeech = {
  stream: Promise<{ ticket: string; uri: string }>;
  cancel: () => void;
  claim: () => void;
};

export function prepareSpeech(text: string): PreparedSpeech | null {
  const spoken = stripForSpeech(text);
  if (!spoken) return null;
  const controller = new AbortController();
  let ticket: string | null = null;
  let claimed = false;
  let canceled = false;
  const stream = prepareReadAloudStream(spoken, controller.signal).then((prepared) => {
    ticket = prepared.ticket;
    if (canceled) cancelStreamSession(prepared.ticket);
    return prepared;
  });
  stream.catch(() => undefined);
  return {
    stream,
    claim: () => {
      claimed = true;
    },
    cancel: () => {
      if (claimed || canceled) return;
      canceled = true;
      controller.abort();
      if (ticket) cancelStreamSession(ticket);
    },
  };
}

export type SpeakReplyOptions = {
  background?: boolean;
  quiet?: boolean;
  prepared?: PreparedSpeech;
};

export async function speakReply(
  text: string,
  messageId?: string,
  options: SpeakReplyOptions = {},
) {
  const spoken = stripForSpeech(text);
  if (!spoken) return;

  stopReadAloud();
  const generation = playbackGeneration;
  const signal = beginPlaybackWork();
  const id = messageId ?? null;
  setPlaybackState({ messageId: id, status: "loading" });

  try {
    await tryStreamReply(spoken, id, generation, signal, options);
  } catch (error) {
    if (generation !== playbackGeneration || signal.aborted) return;
    stopReadAloud();
    if (options.quiet) return;
    console.warn("[read-aloud] could not start speech", error);
    Alert.alert(
      "Couldn’t read aloud",
      "Speech could not be started. Please try again.",
    );
  }
}

async function tryStreamReply(
  text: string,
  id: string | null,
  generation: number,
  signal: AbortSignal,
  options: SpeakReplyOptions,
): Promise<boolean> {
  options.prepared?.claim();
  const { ticket, uri } = options.prepared
    ? await options.prepared.stream
    : await prepareReadAloudStream(text, signal);
  if (generation !== playbackGeneration || signal.aborted) {
    cancelStreamSession(ticket);
    return true;
  }

  currentStreamTicket = ticket;

  const [, sessionReady] = await Promise.all([
    waitForPlaylistReady(uri, signal),
    playbackSession.acquire({ background: options.background }),
  ]);
  if (generation !== playbackGeneration || signal.aborted) {
    cancelStreamSession(ticket);
    return true;
  }

  if (!sessionReady) {
    if (generation === playbackGeneration) stopReadAloud();
    else cancelStreamSession(ticket);
    return true;
  }
  if (generation !== playbackGeneration || signal.aborted) {
    cancelStreamSession(ticket);
    return true;
  }

  return await playHlsResilient(uri, id, generation, 0, options.quiet === true);
}

async function waitForPlaylistReady(uri: string, signal: AbortSignal) {
  const deadline = Date.now() + PLAYLIST_READY_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    let delayMs = PLAYLIST_READY_POLL_MS;
    try {
      const response = await fetchWithinDeadline(
        uri,
        { headers: { "cache-control": "no-cache" } },
        {
          label: "Preparing read-aloud",
          timeoutMs: Math.min(REQUEST_BUDGET_MS.lookup, Math.max(0, deadline - Date.now())),
          signal,
        },
      );
      if (response.ok) return;
      const body = (await response.json().catch(() => null)) as {
        error?: Partial<BackendError>;
      } | null;
      if (body?.error?.retryable !== true) return;
      delayMs = Math.min(
        Math.max(body.error.retryAfterMs ?? PLAYLIST_READY_POLL_MS, PLAYLIST_READY_POLL_MS),
        Math.max(0, deadline - Date.now()),
      );
    } catch {
      if (signal.aborted) return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

let disposeHlsPlayback: (() => void) | null = null;

async function playHlsResilient(
  uri: string,
  id: string | null,
  generation: number,
  startAt: number,
  quiet = false,
): Promise<boolean> {
  disposeHlsPlayback?.();
  return await new Promise<boolean>((resolve) => {
    let started = false;
    let finished = false;
    let recovering = false;
    let recoverAttempts = 0;
    let startRetries = 0;
    let lastTime = startAt;
    let lastProgressAt = Date.now();
    let expectedDur = 0;
    let player: AudioPlayer | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const superseded = () => generation !== playbackGeneration;

    const dropPlayer = () => {
      const p = player;
      player = null;
      if (currentPlayer === p) currentPlayer = null;
      if (p) disposeAudioPlayer(p);
    };
    const clearStartTimer = () => {
      if (startTimer !== null) clearTimeout(startTimer);
      startTimer = null;
    };
    const dispose = () => {
      finished = true;
      clearStartTimer();
      if (retryTimer !== null) clearTimeout(retryTimer);
      clearHlsWatchdog();
      dropPlayer();
      if (disposeHlsPlayback === dispose) {
        disposeHlsPlayback = null;
        playbackSession.release();
      }
      resolve(true);
    };
    disposeHlsPlayback = dispose;

    const giveUp = () => {
      dispose();
      if (superseded()) return;
      if (quiet) {
        hlsResume = null;
        const ticket = currentStreamTicket;
        currentStreamTicket = null;
        if (ticket) cancelStreamSession(ticket);
        setPlaybackState(null);
        return;
      }
      hlsResume = { uri, id, at: lastTime };
      setPlaybackState({ messageId: id, status: "paused" });
      console.warn(
        `[read-aloud] playback stopped at ${lastTime.toFixed(1)}s after ${startRetries + recoverAttempts} retries`,
      );
      Alert.alert(
        "Playback stopped",
        "Couldn’t play this reply. Retry to continue from where it stopped.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Retry",
            onPress: () => {
              if (!superseded()) resumeReadAloud();
            },
          },
        ],
      );
    };

    const retry = () => {
      if (finished || superseded() || recovering) return;
      clearStartTimer();
      recovering = true;
      dropPlayer();
      if (
        started
          ? recoverAttempts >= HLS_MAX_RECOVER_ATTEMPTS
          : startRetries >= HLS_MAX_START_RETRIES
      ) {
        giveUp();
        return;
      }
      if (started) recoverAttempts += 1;
      else startRetries += 1;
      setPlaybackState({ messageId: id, status: "loading" });
      retryTimer = setTimeout(
        () => {
          retryTimer = null;
          recovering = false;
          if (finished || superseded()) return;
          attach(lastTime);
        },
        started ? HLS_RECOVER_BACKOFF_MS : HLS_START_RETRY_BACKOFF_MS,
      );
    };

    const attach = (at: number) => {
      if (finished || superseded()) return;
      lastProgressAt = Date.now();
      startTimer = setTimeout(retry, STREAM_START_TIMEOUT_MS);
      try {
        playbackSession.hold();
        const p = createAudioPlayer(
          { uri },
          { preferredForwardBufferDuration: 1, keepAudioSessionActive: true },
        );
        player = p;
        currentPlayer = p;
        let seeked = at <= 0.25;
        let seeking = false;
        p.addListener("playbackStatusUpdate", (status) => {
          if (player !== p || finished || superseded()) return;
          if (!seeked) {
            if (!seeking && (status.isLoaded || status.duration > 0)) {
              seeking = true;
              void p
                .seekTo(at)
                .then(() => {
                  if (player !== p || finished || superseded()) return;
                  seeked = true;
                  p.play();
                })
                .catch(() => {
                  if (player === p) retry();
                });
            }
            return;
          }
          if (Number.isFinite(status.duration) && status.duration > expectedDur)
            expectedDur = status.duration;
          const t =
            typeof status.currentTime === "number" ? status.currentTime : 0;
          if (t > lastTime + 0.01) {
            lastTime = t;
            lastProgressAt = Date.now();
            clearStartTimer();
            started = true;
            if (playbackState?.status !== "paused")
              setPlaybackState({ messageId: id, status: "playing" });
            resolve(true);
          }
          const state = (status.playbackState ?? "").toLowerCase();
          if (
            state.includes("error") ||
            state.includes("fail") ||
            status.mediaServicesDidReset === true
          ) {
            retry();
          } else if (status.didJustFinish) {
            if (
              !started ||
              (expectedDur > 0 &&
                lastTime < expectedDur - HLS_PREMATURE_EPS_SEC)
            ) {
              retry();
            } else {
              dispose();
              hlsResume = null;
              currentStreamTicket = null;
              setPlaybackState(null);
            }
          }
        });
        if (seeked) p.play();
      } catch {
        retry();
      }
    };

    hlsWatchdog = setInterval(() => {
      if (finished || superseded() || !started || recovering) return;
      if (playbackState?.status === "paused") {
        lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - lastProgressAt > HLS_STALL_TIMEOUT_MS) retry();
    }, HLS_WATCHDOG_INTERVAL_MS);
    attach(startAt);
  });
}

export function useReadAloudPreference() {
  const [enabled, setEnabled] = useState(readAloudStore.getSnapshot);

  useEffect(() => {
    void loadReadAloudPreference();
    return readAloudStore.subscribe(() => {
      setEnabled(readAloudStore.getSnapshot());
    });
  }, []);

  return useMemo(
    () => ({
      enabled,
      setEnabled: setReadAloudEnabled,
    }),
    [enabled],
  );
}
