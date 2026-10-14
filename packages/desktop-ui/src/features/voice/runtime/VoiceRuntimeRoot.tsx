import { useEffect, useRef, useState } from "react";
import { useUiState } from "@/context/ui-state";
import { type VoiceSessionState } from "@/features/voice/services/realtime-voice";
import { VoiceSessionManager } from "@/features/voice/hooks/use-realtime-voice";
import {
  acquireSharedMicrophone,
  type SharedMicrophoneLease,
} from "@/features/voice/services/shared-microphone";
import { computeAnalyserEnergy } from "@/features/voice/services/audio-energy";
import {
  providerBillsConnectedTime,
  resolveActiveProvider,
} from "@/features/voice/services/realtime/providers/provider-registry";
import type { RealtimeProviderKey } from "@/features/voice/services/realtime/providers/types";

type RuntimeVoiceState = {
  sessionState: VoiceSessionState;
  isConnected: boolean;
  isSpeaking: boolean;
  isUserSpeaking: boolean;
  micLevel: number;
  outputLevel: number;
};

const LEVEL_SAMPLE_MS = 24;
const DEFAULT_RUNTIME_STATE: RuntimeVoiceState = {
  sessionState: "idle",
  isConnected: false,
  isSpeaking: false,
  isUserSpeaking: false,
  micLevel: 0,
  outputLevel: 0,
};

let energyBuffer: Uint8Array | null = null;

const computeEnergy = (analyser: AnalyserNode | null): number => {
  const result = computeAnalyserEnergy(analyser, energyBuffer);
  energyBuffer = result.buffer;
  return result.energy;
};

const runtimeStateEquals = (a: RuntimeVoiceState, b: RuntimeVoiceState) =>
  a.sessionState === b.sessionState &&
  a.isConnected === b.isConnected &&
  a.isSpeaking === b.isSpeaking &&
  a.isUserSpeaking === b.isUserSpeaking &&
  Math.abs(a.micLevel - b.micLevel) < 0.01 &&
  Math.abs(a.outputLevel - b.outputLevel) < 0.01;

export function VoiceRuntimeRoot() {
  const { state } = useUiState();
  const [bootConversationId, setBootConversationId] = useState<string | null>(
    state.conversationId,
  );
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [voiceProvider, setVoiceProvider] =
    useState<RealtimeProviderKey | null>(null);
  const [voiceRouteRevision, setVoiceRouteRevision] = useState(0);
  const managerRouteRevisionRef = useRef(0);
  const sessionShouldRun =
    state.isVoiceRtcActive ||
    (wakeWordEnabled &&
      voiceProvider !== null &&
      !providerBillsConnectedTime(voiceProvider));
  const analyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const conversationIdRef = useRef<string>(state.conversationId ?? "voice-rtc");
  const inputActiveRef = useRef<boolean>(state.isVoiceRtcActive);
  const managerRef = useRef<VoiceSessionManager | null>(null);
  const warmMicLeaseRef = useRef<SharedMicrophoneLease | null>(null);
  const publishedStateRef = useRef<RuntimeVoiceState>(DEFAULT_RUNTIME_STATE);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speakingRef = useRef(false);
  const userSpeakingRef = useRef(false);
  const sessionStateRef = useRef<VoiceSessionState>("idle");
  const lastVoiceErrorToastRef = useRef<string | null>(null);
  const resolvedConversationId = state.conversationId ?? bootConversationId;

  const publishRuntimeState = (patch: Partial<RuntimeVoiceState>) => {
    const next: RuntimeVoiceState = {
      ...publishedStateRef.current,
      ...patch,
    };
    if (runtimeStateEquals(publishedStateRef.current, next)) {
      return;
    }
    publishedStateRef.current = next;
    window.electronAPI?.voice.pushRuntimeState(next);
  };

  useEffect(() => {
    if (!state.conversationId || state.conversationId === bootConversationId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setBootConversationId(state.conversationId);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [bootConversationId, state.conversationId]);

  useEffect(() => {
    if (!sessionShouldRun || state.conversationId || bootConversationId) {
      return;
    }

    const getDefaultConversationId =
      window.electronAPI?.localChat.getOrCreateDefaultConversationId;
    if (!getDefaultConversationId) {
      const timer = window.setTimeout(() => {
        setBootConversationId("voice-rtc");
      }, 0);
      return () => {
        window.clearTimeout(timer);
      };
    }

    let cancelled = false;
    void getDefaultConversationId()
      .then((conversationId) => {
        if (!cancelled) {
          setBootConversationId(conversationId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBootConversationId("voice-rtc");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootConversationId, state.conversationId, sessionShouldRun]);

  useEffect(() => {
    inputActiveRef.current = state.isVoiceRtcActive;
  }, [state.isVoiceRtcActive]);

  useEffect(() => {
    let cancelled = false;

    if (!wakeWordEnabled) {
      warmMicLeaseRef.current?.release();
      warmMicLeaseRef.current = null;
      return;
    }

    void acquireSharedMicrophone()
      .then((lease) => {
        if (cancelled || !wakeWordEnabled) {
          lease.release();
          return;
        }
        warmMicLeaseRef.current?.release();
        warmMicLeaseRef.current = lease;
      })
      .catch((error) => {
        console.debug(
          "[voice-runtime] Failed to warm microphone for wake word:",
          (error as Error).message,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [wakeWordEnabled]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.system
      ?.getWakeWordEnabled?.()
      .then((enabled) => {
        if (!cancelled) setWakeWordEnabled(enabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveActiveProvider().then((provider) => {
      if (!cancelled) setVoiceProvider(provider);
    });
    const unsubscribe = window.electronAPI?.voice.onPreferencesChanged?.(
      (preferences) => {
        setVoiceRouteRevision((revision) => revision + 1);
        setVoiceProvider(preferences.provider);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(
    () => window.electronAPI?.system?.onWakeWordEnabledChanged?.(setWakeWordEnabled),
    [],
  );

  const stopRuntimeSession = () => {
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    managerRef.current?.stop();
    managerRef.current = null;
    speakingRef.current = false;
    userSpeakingRef.current = false;
    sessionStateRef.current = "idle";
    analyserRef.current = null;
    outputAnalyserRef.current = null;
    publishedStateRef.current = DEFAULT_RUNTIME_STATE;
    window.electronAPI?.voice.pushRuntimeState(DEFAULT_RUNTIME_STATE);
  };

  useEffect(() => {
    if (!sessionShouldRun) {
      stopRuntimeSession();
      return;
    }

    if (!resolvedConversationId || managerRef.current) {
      return;
    }

    conversationIdRef.current = resolvedConversationId;
    publishRuntimeState(DEFAULT_RUNTIME_STATE);

    const manager = new VoiceSessionManager({
      conversationIdRef,
      inputActiveRef,
      analyserRef,
      outputAnalyserRef,
      onStateChange: (sessionState, failure) => {
        sessionStateRef.current = sessionState;
        if (sessionState === "error") {
          const message = failure?.message ?? "";
          window.electronAPI?.voice.reportSessionErrorState?.(message);
          if (
            failure?.action &&
            message.trim() &&
            lastVoiceErrorToastRef.current !== message
          ) {
            lastVoiceErrorToastRef.current = message;
            window.electronAPI?.voice.reportSessionError(failure);
          }
        } else {
          lastVoiceErrorToastRef.current = null;
          if (sessionState === "connected") {
            window.electronAPI?.voice.reportSessionErrorState?.("");
          }
        }
        publishRuntimeState({
          sessionState,
          isConnected: sessionState === "connected",
          micLevel:
            sessionState === "connected"
              ? publishedStateRef.current.micLevel
              : 0,
          outputLevel:
            sessionState === "connected"
              ? publishedStateRef.current.outputLevel
              : 0,
        });
      },
      onSpeakingChange: (isSpeaking) => {
        speakingRef.current = isSpeaking;
        publishRuntimeState({ isSpeaking });
      },
      onUserSpeakingChange: (isUserSpeaking) => {
        userSpeakingRef.current = isUserSpeaking;
        publishRuntimeState({ isUserSpeaking });
      },
    });

    managerRef.current = manager;
    managerRouteRevisionRef.current = voiceRouteRevision;
    manager.start();

    levelTimerRef.current = setInterval(() => {
      analyserRef.current = manager.getAnalyser();
      outputAnalyserRef.current = manager.getOutputAnalyser();

      publishRuntimeState({
        sessionState: sessionStateRef.current,
        isConnected: sessionStateRef.current === "connected",
        isSpeaking: speakingRef.current,
        isUserSpeaking: userSpeakingRef.current,
        micLevel: computeEnergy(analyserRef.current),
        outputLevel: computeEnergy(outputAnalyserRef.current),
      });
    }, LEVEL_SAMPLE_MS);
  }, [resolvedConversationId, sessionShouldRun]);

  useEffect(() => {
    if (voiceRouteRevision <= managerRouteRevisionRef.current) return;
    managerRouteRevisionRef.current = voiceRouteRevision;
    managerRef.current?.restart();
  }, [voiceRouteRevision]);

  useEffect(() => {
    return () => {
      warmMicLeaseRef.current?.release();
      warmMicLeaseRef.current = null;
      stopRuntimeSession();
    };
  }, []);

  useEffect(() => {
    if (!resolvedConversationId) {
      return;
    }

    conversationIdRef.current = resolvedConversationId;
    managerRef.current?.updateSession(
      resolvedConversationId,
      state.isVoiceRtcActive,
    );
  }, [resolvedConversationId, state.isVoiceRtcActive]);

  return null;
}
