import { useCallback, useEffect, useRef, useState } from "react";
import {
  ensureDictationSuperFastWarm,
  DictationSession,
  isDictationSuperFastEnabled,
  warmDictationAudio,
  type DictationSessionState,
} from "@/features/dictation/services/dictation-session";
import {
  cachedDictationRoute,
  prewarmDictation,
  resolveDictationRoute,
} from "@/features/dictation/services/dictation-transcriber";
import { prewarmDictationSocket } from "@/features/dictation/services/dictation-stream";
import {
  DICTATION_KEY_SAVED_EVENT,
  requestDictationKey,
} from "@/features/dictation/components/DictationKeyDialog";
import { appendRollingLevel } from "@/features/dictation/rolling-levels";
import { showToast } from "@/ui/toast";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { presentComposerNotice } from "@/features/chat/composer-notice-store";
import { useT } from "@/shared/i18n";

export const DICTATION_TOGGLE_EVENT = "stella:dictation-toggle";

type DictationToggleEventDetail = {
  startId?: string;
  action?: "toggle" | "start" | "stop" | "cancel";
  source?: "companion";
};

const MAX_LEVEL_BARS = 256;

type Setter<T> = (next: T | ((prev: T) => T)) => void;

interface UseDictationOptions {
  setMessage: Setter<string>;
  disabled?: boolean;
  onError?: (error: string) => void;
  onTranscriptCommitted?: () => void;
  onCommit?: () => void;
  commitOnShortcutStop?: boolean;
}

interface UseDictationResult {
  prewarm: () => void;
  isRecording: boolean;
  isRecordingVisible: boolean;
  isTranscribing: boolean;
  showControls: boolean;
  state: DictationSessionState;
  toggle: () => void;
  cancel: () => void;
  commitAndSend: () => void;
  levels: number[];
  elapsedMs: number;
  error: string | null;
}

const joinTranscriptOntoBase = (base: string, transcript: string): string => {
  if (!transcript) return base;
  if (!base) return transcript;
  const trimmedBase = base.replace(/\s+$/, "");
  return `${trimmedBase} ${transcript}`;
};

export const useDictation = ({
  setMessage,
  disabled = false,
  onError,
  onTranscriptCommitted,
  onCommit,
  commitOnShortcutStop = false,
}: UseDictationOptions): UseDictationResult => {
  const t = useT();
  const [state, setState] = useState<DictationSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [showRecordingBar, setShowRecordingBar] = useState(false);

  const sessionRef = useRef<DictationSession | null>(null);
  const setMessageRef = useRef(setMessage);
  const onErrorRef = useRef(onError);
  const onTranscriptCommittedRef = useRef(onTranscriptCommitted);
  const onCommitRef = useRef(onCommit);
  const commitOnShortcutStopRef = useRef(commitOnShortcutStop);
  const stateRef = useRef<DictationSessionState>("idle");
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const sendAfterCommitRef = useRef(false);
  const warmedRef = useRef(false);
  const awaitingKeyRef = useRef(false);

  setMessageRef.current = setMessage;
  onErrorRef.current = onError;
  onTranscriptCommittedRef.current = onTranscriptCommitted;
  onCommitRef.current = onCommit;
  commitOnShortcutStopRef.current = commitOnShortcutStop;

  const fireCommitIfPending = useCallback(() => {
    if (!sendAfterCommitRef.current) return;
    sendAfterCommitRef.current = false;
    onCommitRef.current?.();
  }, []);

  stateRef.current = state;

  useEffect(() => {
    if (disabled) return;
    prewarmDictation();
    window.addEventListener("focus", prewarmDictation);
    return () => window.removeEventListener("focus", prewarmDictation);
  }, [disabled]);

  useEffect(() => {
    if (state !== "listening") return;
    const startedAt = performance.now();
    const id = setInterval(() => {
      setElapsedMs(performance.now() - startedAt);
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await session.stop();
    } catch (err) {
      console.debug("[dictation] stop failed:", (err as Error).message);
    }
  }, []);

  const cancel = useCallback(() => {
    sendAfterCommitRef.current = false;
    const session = sessionRef.current;
    if (!session) return;
    setLevels([]);
    setShowControls(false);
    setShowRecordingBar(false);
    void session.cancel().catch((err: Error) => {
      console.debug("[dictation] cancel failed:", err.message);
    });
  }, []);

  useEffect(() => {
    if (state !== "transcribing") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [cancel, state]);

  const start = useCallback(
    async (source: "button" | "shortcut") => {
      if (sessionRef.current) return;
      if (disabled) return;
      const cached = cachedDictationRoute();
      const route =
        cached === "streaming" || cached === "managed" || cached === "openrouter"
          ? cached
          : await resolveDictationRoute().catch(() => "needs-key" as const);
      if (route === "needs-key") {
        if (requestDictationKey()) {
          awaitingKeyRef.current = true;
        } else {
          const message = t("features.dictation.keyDialog.openStella");
          setError(message);
          onErrorRef.current?.(message);
          showToast({ title: t("features.dictation.keyDialog.title"), description: message });
        }
        return;
      }
      if (sessionRef.current) return;
      if (!warmedRef.current) {
        warmedRef.current = true;
        if (isDictationSuperFastEnabled()) {
          void ensureDictationSuperFastWarm().catch(() => undefined);
        }
      }
      const session = new DictationSession();
      sessionRef.current = session;
      setError(null);
      setLevels([]);
      setElapsedMs(0);
      setShowControls(source === "button");
      setShowRecordingBar(true);

      try {
        await session.start({
          onStateChange: (next, errMessage) => {
            setState(next);
            window.electronAPI?.dictation?.activeChanged({
              active: next === "listening" || next === "transcribing",
            });
            if (next === "error" && errMessage) {
              console.warn(
                "[dictation] session entered error state:",
                errMessage,
              );
              setError(errMessage);
              const normalized = errMessage.toLowerCase();
              const needsSignIn =
                /\b401\b|\b403\b|unauthor|unauthenticated|sign[\s-]?in|not signed in/.test(
                  normalized,
                );
              if (needsSignIn) {
                presentComposerNotice({
                  conversationId: null,
                  kind: "sign-in",
                  title: t("features.dictation.signInTitle"),
                  description: t("features.dictation.signInBody"),
                  action: SIGN_IN_TOAST_ACTION,
                });
              } else {
                showToast({
                  title: t("features.dictation.failedTitle"),
                  description: t("features.dictation.failedBody"),
                  variant: "error",
                });
              }
              onErrorRef.current?.(errMessage);
            }
            if (next === "idle" || next === "error") {
              sessionRef.current = null;
              setLevels([]);
              setShowControls(false);
              setShowRecordingBar(false);
              fireCommitIfPending();
            }
          },
          onFinalTranscript: (transcript) => {
            setMessageRef.current((current) =>
              joinTranscriptOntoBase(current, transcript),
            );
            onTranscriptCommittedRef.current?.();
          },
          onLevel: (level) => {
            setLevels((prev) =>
              appendRollingLevel(prev, level, MAX_LEVEL_BARS),
            );
          },
        }, { streaming: route === "streaming" });
      } catch (err) {
        const errMessage = (err as Error).message;
        setError(errMessage);
        onErrorRef.current?.(errMessage);
        window.electronAPI?.dictation?.activeChanged({ active: false });
        sessionRef.current = null;
        setLevels([]);
        setShowControls(false);
        setShowRecordingBar(false);
      }
    },
    [disabled, fireCommitIfPending, t],
  );

  useEffect(() => {
    const onKeySaved = () => {
      if (!awaitingKeyRef.current) return;
      awaitingKeyRef.current = false;
      window.electronAPI?.dictation?.playSound({ sound: "startRecording" });
      void start("button");
    };
    window.addEventListener(DICTATION_KEY_SAVED_EVENT, onKeySaved);
    return () => window.removeEventListener(DICTATION_KEY_SAVED_EVENT, onKeySaved);
  }, [start]);

  const toggle = useCallback(() => {
    const current = stateRef.current;
    if (current === "listening") {
      sendAfterCommitRef.current = false;
      window.electronAPI?.dictation?.playSound({ sound: "stopRecording" });
      void stop();
    } else if (current === "transcribing") {
      return;
    } else {
      sendAfterCommitRef.current = false;
      window.electronAPI?.dictation?.playSound({ sound: "startRecording" });
      void start("button");
    }
  }, [start, stop]);

  const commitAndSend = useCallback(() => {
    const current = stateRef.current;
    if (current === "listening") {
      sendAfterCommitRef.current = true;
      void stop();
      return;
    }
    if (current === "transcribing") {
      sendAfterCommitRef.current = true;
      return;
    }
    onCommitRef.current?.();
  }, [stop]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<DictationToggleEventDetail>).detail;
      const startId = detail?.startId;
      const action = detail?.action ?? "toggle";
      const current = stateRef.current;
      const canHandle =
        !disabled || current === "listening" || current === "transcribing";
      if (!canHandle) return;
      void startId;
      if (action === "start") {
        if (current !== "listening" && current !== "transcribing") {
          void start("shortcut");
        }
        return;
      }
      if (action === "stop") {
        if (current === "listening") {
          sendAfterCommitRef.current = commitOnShortcutStopRef.current;
          void stop();
        }
        return;
      }
      if (action === "cancel") {
        if (current === "listening" || current === "transcribing") {
          cancel();
        }
        return;
      }
      if (current === "listening") {
        sendAfterCommitRef.current = commitOnShortcutStopRef.current;
        void stop();
      } else if (current === "transcribing") {
        if (commitOnShortcutStopRef.current) sendAfterCommitRef.current = true;
      } else {
        sendAfterCommitRef.current = false;
        void start("shortcut");
      }
    };
    window.addEventListener(DICTATION_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(DICTATION_TOGGLE_EVENT, handler);
  }, [cancel, disabled, start, stop]);

  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session) {
        window.electronAPI?.dictation?.activeChanged({ active: false });
        void session.cancel().catch(() => undefined);
        sessionRef.current = null;
      }
    };
  }, []);

  const prewarm = useCallback(() => {
    const route = cachedDictationRoute();
    if (route === "streaming") prewarmDictationSocket();
    else prewarmDictation();
    if (!disabledRef.current && route !== null && route !== "needs-key") {
      warmDictationAudio();
    }
  }, []);

  return {
    isRecording: state === "listening",
    isRecordingVisible: state === "listening" && showRecordingBar,
    isTranscribing: state === "transcribing",
    showControls,
    state,
    toggle,
    prewarm,
    cancel,
    commitAndSend,
    levels,
    elapsedMs,
    error,
  };
};
