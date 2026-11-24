import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DictationToggle } from "@stella/contracts/desktop/ipc-contract";
import {
  armBrowserMicrophone,
  disarmBrowserMicrophone,
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
  type DictationRoute,
} from "@/features/dictation/services/dictation-transcriber";
import {
  armNativeMicrophone,
  discardNativeCapture,
  nativeMicrophoneReady,
} from "@/features/dictation/services/native-microphone";
import { prewarmDictationSocket } from "@/features/dictation/services/dictation-stream";
import {
  DICTATION_KEY_SAVED_EVENT,
  requestDictationKey,
} from "@/features/dictation/components/DictationKeyDialog";
import { isMicrophoneEnabled } from "@/features/voice/services/shared-microphone";
import { showToast } from "@/ui/toast";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { presentComposerNotice } from "@/features/chat/composer-notice-store";
import { useT } from "@/shared/i18n";

export const DICTATION_TOGGLE_EVENT = "stella:dictation-toggle";

type DictationSurface = {
  isActive: () => boolean;
  canStart: () => boolean;
  hasFocus: () => boolean;
  toggle: (startId: string) => void;
};

const surfaces = new Set<DictationSurface>();

const surfaceForShortcut = (): DictationSurface | undefined => {
  const all = [...surfaces];
  const active = all.find((surface) => surface.isActive());
  if (active) return active;
  const usable = all.filter((surface) => surface.canStart());
  return usable.find((surface) => surface.hasFocus()) ?? usable.at(-1);
};

const onToggleEvent = (event: Event): void => {
  const detail = (event as CustomEvent<DictationToggle | undefined>).detail;
  const startId = detail?.startId ?? crypto.randomUUID();
  const surface = surfaceForShortcut();
  if (surface) surface.toggle(startId);
  else discardNativeCapture(startId);
};

const registerSurface = (surface: DictationSurface): (() => void) => {
  if (surfaces.size === 0) window.addEventListener(DICTATION_TOGGLE_EVENT, onToggleEvent);
  surfaces.add(surface);
  return () => {
    surfaces.delete(surface);
    if (surfaces.size === 0) window.removeEventListener(DICTATION_TOGGLE_EVENT, onToggleEvent);
  };
};

type Setter<T> = (next: T | ((prev: T) => T)) => void;

interface UseDictationOptions {
  setMessage: Setter<string>;
  disabled?: boolean;
  onError?: (error: string) => void;
  onTranscriptCommitted?: () => void;
  onCommit?: () => void;
  commitOnShortcutStop?: boolean;
  surfaceRef?: RefObject<HTMLElement | null>;
}

interface UseDictationResult {
  prewarm: () => void;
  arm: (event: { button: number }) => void;
  isRecording: boolean;
  isRecordingVisible: boolean;
  isTranscribing: boolean;
  showControls: boolean;
  state: DictationSessionState;
  toggle: () => void;
  cancel: () => void;
  commitAndSend: () => void;
  readLevel: () => number;
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
  surfaceRef,
}: UseDictationOptions): UseDictationResult => {
  const t = useT();
  const [state, setState] = useState<DictationSessionState>("idle");
  const [error, setError] = useState<string | null>(null);
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
  const pendingStartRef = useRef<{ stopRequested: boolean } | null>(null);
  const armedRef = useRef<string | null>(null);

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
    if (pendingStartRef.current) pendingStartRef.current.stopRequested = true;
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
    if (pendingStartRef.current) pendingStartRef.current.stopRequested = true;
    const session = sessionRef.current;
    if (!session) return;
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

  const showNeedsKey = useCallback(() => {
    if (requestDictationKey()) {
      awaitingKeyRef.current = true;
      return;
    }
    const message = t("features.dictation.keyDialog.openStella");
    setError(message);
    onErrorRef.current?.(message);
    showToast({ title: t("features.dictation.keyDialog.title"), description: message });
  }, [t]);

  const start = useCallback(
    async (source: "button" | "shortcut", captureId: string) => {
      if (sessionRef.current || pendingStartRef.current || disabled) {
        discardNativeCapture(captureId);
        return;
      }
      const cached = cachedDictationRoute();
      let route: Promise<DictationRoute>;
      if (cached === "needs-key") {
        const pending = { stopRequested: false };
        pendingStartRef.current = pending;
        setState("starting");
        window.electronAPI?.dictation?.activeChanged({ active: true });
        const resolved = await resolveDictationRoute().catch(() => "needs-key" as const);
        pendingStartRef.current = null;
        if (pending.stopRequested || resolved === "needs-key") {
          discardNativeCapture(captureId);
          setState("idle");
          window.electronAPI?.dictation?.activeChanged({ active: false });
          fireCommitIfPending();
          if (!pending.stopRequested) showNeedsKey();
          return;
        }
        route = Promise.resolve(resolved);
      } else {
        route = cached ? Promise.resolve(cached) : resolveDictationRoute();
      }
      if (!warmedRef.current) {
        warmedRef.current = true;
        if (isDictationSuperFastEnabled()) {
          void ensureDictationSuperFastWarm().catch(() => undefined);
        }
      }
      const session = new DictationSession();
      sessionRef.current = session;
      setError(null);
      setElapsedMs(0);
      setShowControls(source === "button");
      setShowRecordingBar(true);

      try {
        await session.start({
          onNeedsKey: showNeedsKey,
          onStateChange: (next, errMessage) => {
            setState(next);
            if (next === "listening") {
              window.electronAPI?.dictation?.playSound({ sound: "startRecording" });
            }
            window.electronAPI?.dictation?.activeChanged({
              active: next !== "idle" && next !== "error",
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
        }, { route, captureId });
      } catch (err) {
        const errMessage = (err as Error).message;
        setError(errMessage);
        onErrorRef.current?.(errMessage);
        window.electronAPI?.dictation?.activeChanged({ active: false });
        sessionRef.current = null;
        setShowControls(false);
        setShowRecordingBar(false);
      }
    },
    [disabled, fireCommitIfPending, showNeedsKey, t],
  );

  useEffect(() => {
    const onKeySaved = () => {
      if (!awaitingKeyRef.current) return;
      awaitingKeyRef.current = false;
      void start("button", crypto.randomUUID());
    };
    window.addEventListener(DICTATION_KEY_SAVED_EVENT, onKeySaved);
    return () => window.removeEventListener(DICTATION_KEY_SAVED_EVENT, onKeySaved);
  }, [start]);

  const toggle = useCallback(() => {
    const current = stateRef.current;
    if (current === "listening" || current === "starting") {
      sendAfterCommitRef.current = false;
      window.electronAPI?.dictation?.playSound({ sound: "stopRecording" });
      void stop();
    } else if (current === "transcribing") {
      return;
    } else {
      sendAfterCommitRef.current = false;
      const captureId = armedRef.current ?? crypto.randomUUID();
      armedRef.current = null;
      void start("button", captureId);
    }
  }, [start, stop]);

  const arm = useCallback((event: { button: number }) => {
    const route = cachedDictationRoute();
    if (
      event.button !== 0 ||
      disabledRef.current ||
      sessionRef.current ||
      pendingStartRef.current ||
      stateRef.current === "transcribing" ||
      route === null ||
      route === "needs-key"
    ) {
      return;
    }
    const captureId = crypto.randomUUID();
    const native = nativeMicrophoneReady();
    armedRef.current = captureId;
    if (native) armNativeMicrophone(captureId);
    else if (isMicrophoneEnabled()) armBrowserMicrophone();
    const settle = () => {
      window.removeEventListener("pointerup", settle, true);
      window.removeEventListener("pointercancel", settle, true);
      setTimeout(() => {
        if (armedRef.current !== captureId) return;
        armedRef.current = null;
        if (native) discardNativeCapture(captureId);
        else disarmBrowserMicrophone();
      }, 0);
    };
    window.addEventListener("pointerup", settle, true);
    window.addEventListener("pointercancel", settle, true);
  }, []);

  const commitAndSend = useCallback(() => {
    const current = stateRef.current;
    if (current === "listening" || current === "starting") {
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

  useEffect(
    () =>
      registerSurface({
        isActive: () => {
          const current = stateRef.current;
          return current === "starting" || current === "listening" || current === "transcribing";
        },
        canStart: () => {
          if (disabled) return false;
          if (!surfaceRef) return true;
          const element = surfaceRef.current;
          return Boolean(element?.checkVisibility() && !element.closest("[inert]"));
        },
        hasFocus: () => surfaceRef?.current?.contains(document.activeElement) === true,
        toggle: (startId) => {
          const current = stateRef.current;
          if (current === "starting" || current === "listening") {
            discardNativeCapture(startId);
            sendAfterCommitRef.current = commitOnShortcutStopRef.current;
            void stop();
          } else if (current === "transcribing") {
            discardNativeCapture(startId);
            if (commitOnShortcutStopRef.current) sendAfterCommitRef.current = true;
          } else {
            sendAfterCommitRef.current = false;
            void start("shortcut", startId);
          }
        },
      }),
    [disabled, start, stop, surfaceRef],
  );

  useEffect(() => {
    return () => {
      if (pendingStartRef.current) pendingStartRef.current.stopRequested = true;
      const session = sessionRef.current;
      if (session) {
        window.electronAPI?.dictation?.activeChanged({ active: false });
        void session.cancel().catch(() => undefined);
        sessionRef.current = null;
      }
    };
  }, []);

  const readLevel = useCallback(
    () => sessionRef.current?.readLevel() ?? 0,
    [],
  );

  const prewarm = useCallback(() => {
    const route = cachedDictationRoute();
    if (route === "streaming") prewarmDictationSocket();
    else prewarmDictation();
    if (!disabledRef.current && route !== null && route !== "needs-key") {
      warmDictationAudio();
    }
  }, []);

  return {
    arm,
    isRecording: state === "listening",
    isRecordingVisible: state === "listening" && showRecordingBar,
    isTranscribing: state === "transcribing",
    showControls,
    state,
    toggle,
    prewarm,
    cancel,
    commitAndSend,
    readLevel,
    elapsedMs,
    error,
  };
};
