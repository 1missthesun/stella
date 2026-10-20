import { useCallback, useEffect, useRef, useState } from "react";
import { AudioModule } from "expo-audio";
import { AudioStudioModule } from "@siteed/audio-studio";
import { LegacyEventEmitter, type EventSubscription } from "expo-modules-core";
import { File } from "expo-file-system";
import { Alert, AppState, Linking } from "react-native";
import { createDictationLevelMeter } from "@stella/contracts/dictation-waveform";
import { hasAiConsent, requestAiConsent } from "./ai-consent";
import {
  acquireRecordingAudioSession,
  prewarmDictationAudioSession,
  releaseRecordingAudioSession,
  type RecordingAudioLease,
} from "./mobile-audio-session";
import {
  DICTATION_RECORDING_OPTIONS,
  PREWARMED_START_OPTIONS,
  claimPreparedDictationRecorder,
  keepScreenAwakeForDictation,
  releaseClaimedDictationRecorder,
  releaseDictationRecorderPrewarm,
} from "./dictation-prewarm";
import { stopReadAloudForDictation } from "./read-aloud";
import {
  DICTATION_MAX_PCM_BYTES,
  DICTATION_SAMPLE_RATE,
  loadDictationStreamingAvailable,
  transcribeDictationWav,
  wavFromPcm16,
} from "./dictation-transcribe";
import {
  DictationStream,
  loadDictationRealtimeConfig,
  releaseWarmDictationSocket,
  warmDictationSocket,
} from "./dictation-stream";
import { DictationIngressPacer } from "./dictation-pacer";
import { tapLight, tapMedium } from "./haptics";
import {
  startDictationMeter,
  stopDictationMeter,
  pushDictationLevel,
} from "./dictation-meter";

const MIN_RECORDING_MS = 300;
const MIN_PCM_BYTES = DICTATION_SAMPLE_RATE / 5;

export type DictationStatus = "idle" | "recording" | "transcribing";

export type UseDictationOptions = {
  onTranscript: (text: string) => void;
  prewarm?: boolean;
};

export type UseDictationResult = {
  status: DictationStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  start: () => Promise<boolean>;
  stop: () => Promise<string | null>;
  cancel: () => Promise<string | null>;
  toggle: () => Promise<void>;
  prewarm: () => void;
};

type DictationCapture = {
  chunks: ArrayBuffer[];
  bytes: number;
  full: boolean;
  live: DictationLive | null;
  routed: Promise<void>;
  pressedAt: number;
  firstAudioAt: number;
  marks: Record<string, number>;
};

type DictationLive = {
  stream: DictationStream;
  opened: Promise<void>;
  pacer: DictationIngressPacer;
};

const discardLive = (live: DictationLive | null): void => {
  if (!live) return;
  live.pacer.stop();
  live.stream.cancel();
};

const finishLive = async (live: DictationLive): Promise<string> => {
  live.pacer.stopPadding();
  await live.opened;
  const stream = live.stream;
  stream.throwIfFailed();
  await live.pacer.flushed();
  stream.throwIfFailed();
  return await stream.finish();
};

export function useDictation(options: UseDictationOptions): UseDictationResult {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef<DictationStatus>("idle");
  const operationInFlightRef = useRef(false);
  const recordingLeaseRef = useRef<RecordingAudioLease | null>(null);
  const captureRef = useRef<DictationCapture | null>(null);
  const audioSubscriptionRef = useRef<EventSubscription | null>(null);
  const stopRecordingRef = useRef<(() => Promise<string | null>) | null>(null);
  const onTranscriptRef = useRef(options.onTranscript);
  onTranscriptRef.current = options.onTranscript;
  const prewarmEnabled = options.prewarm === true;
  const prewarmEnabledRef = useRef(prewarmEnabled);
  prewarmEnabledRef.current = prewarmEnabled;
  const claimedRecorderRef = useRef(false);

  const prewarm = useCallback(() => {
    if (!prewarmEnabledRef.current || !mountedRef.current) return;
    if (AppState.currentState !== "active" || !hasAiConsent()) return;
    if (statusRef.current !== "idle" || operationInFlightRef.current) return;
    prewarmDictationAudioSession();
    void loadDictationStreamingAvailable()
      .then((available) => {
        if (available && prewarmEnabledRef.current && mountedRef.current) {
          warmDictationSocket();
        }
      })
      .catch(() => undefined);
  }, []);

  const safeSetStatus = useCallback((next: DictationStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const releaseAudioMode = useCallback(async () => {
    const lease = recordingLeaseRef.current;
    if (lease === null) return;
    recordingLeaseRef.current = null;
    try {
      await releaseRecordingAudioSession(lease);
    } catch {
      // best-effort; the OS will reset on app suspension regardless.
    }
  }, []);

  const discardCapture = useCallback((capture: DictationCapture | null) => {
    if (!capture) return;
    if (captureRef.current === capture) captureRef.current = null;
    capture.chunks = [];
    capture.bytes = 0;
    discardLive(capture.live);
  }, []);

  const openLive = useCallback((): DictationLive => {
    const isCurrent = () =>
      mountedRef.current &&
      captureRef.current?.live === live &&
      statusRef.current === "recording";
    const stream = new DictationStream(
      () => {
        if (isCurrent()) void stopRecordingRef.current?.();
      },
      () => {
        if (isCurrent()) void stopRecordingRef.current?.();
      },
    );
    const live: DictationLive = {
      stream,
      opened: Promise.resolve(),
      pacer: new DictationIngressPacer(stream),
    };
    live.opened = stream.open().then(
      () => {
        live.pacer.start();
        if (captureRef.current?.live !== live) return;
        if (stream.isComplete && isCurrent()) {
          void stopRecordingRef.current?.();
        }
      },
      () => {
        if (isCurrent()) void stopRecordingRef.current?.();
      },
    );
    return live;
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (statusRef.current !== "idle" || operationInFlightRef.current) {
      return false;
    }
    const pressedAt = Date.now();
    stopReadAloudForDictation();
    operationInFlightRef.current = true;
    const prewarmed =
      prewarmEnabledRef.current && hasAiConsent()
        ? await claimPreparedDictationRecorder()
        : false;
    claimedRecorderRef.current = prewarmed;
    const prewarmMark = prewarmed ? 1 : 0;
    // Apple 5.1.1(i): voice audio is sent to a third-party AI transcription
    // transcription service. Don't even start the recorder until the user has
    // explicitly agreed to the data-sharing disclosure.
    if (!hasAiConsent()) {
      requestAiConsent();
      operationInFlightRef.current = false;
      return false;
    }
    const releaseClaim = () => {
      if (!claimedRecorderRef.current) return;
      claimedRecorderRef.current = false;
      releaseClaimedDictationRecorder();
    };
    let phase: "permission" | "audio-session" | "relay" | "recorder" =
      "permission";
    const current: DictationCapture = {
      chunks: [],
      bytes: 0,
      full: false,
      live: null,
      routed: Promise.resolve(),
      pressedAt,
      firstAudioAt: 0,
      marks: { prewarmed: prewarmMark, pressedAt },
    };
    let capture: DictationCapture | null = current;
    captureRef.current = current;
    const permission = prewarmed
      ? Promise.resolve({ granted: true, canAskAgain: true })
      : AudioModule.requestRecordingPermissionsAsync();
    current.routed = Promise.all([
      loadDictationStreamingAvailable().catch(() => false),
      permission.then(
        (result) => result.granted,
        () => false,
      ),
    ]).then(([streaming, granted]) => {
      if (!streaming || !granted || captureRef.current !== current) return;
      const live = openLive();
      current.live = live;
      if (__DEV__) {
        void live.opened.then(() => {
          current.marks.socket = Date.now() - pressedAt;
        });
      }
      for (const chunk of current.chunks.splice(0)) live.pacer.send(chunk);
    });
    try {
      const perm = await permission;
      if (!perm.granted) {
        // If the user previously denied the system prompt, iOS will not
        // show it again — the only way back is the system Settings app.
        // Give them a one-tap path there so they can re-enable the mic
        // without hunting through Settings manually.
        const canAskAgain =
          (perm as { canAskAgain?: boolean }).canAskAgain !== false;
        Alert.alert(
          "Microphone access needed",
          canAskAgain
            ? "Stella needs access to your microphone to record voice messages. You can allow it the next time iOS asks."
            : "Stella needs access to your microphone to record voice messages. Turn it on in Settings → Stella → Microphone.",
          canAskAgain
            ? [{ text: "OK", style: "default" }]
            : [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Open Settings",
                  style: "default",
                  onPress: () => {
                    void Linking.openSettings();
                  },
                },
              ],
        );
        discardCapture(current);
        operationInFlightRef.current = false;
        return false;
      }
      if (!mountedRef.current) {
        if (prewarmed) {
          await AudioStudioModule.stopRecording().catch(() => undefined);
          releaseClaim();
        }
        discardCapture(current);
        operationInFlightRef.current = false;
        return false;
      }

      current.marks.permission = Date.now() - pressedAt;
      phase = "audio-session";
      const lease = await acquireRecordingAudioSession(undefined, {
        prewarmed,
      });
      if (lease === null) {
        if (prewarmed) await AudioStudioModule.stopRecording().catch(() => undefined);
        releaseClaim();
        discardCapture(current);
        operationInFlightRef.current = false;
        return false;
      }
      recordingLeaseRef.current = lease;
      if (!mountedRef.current) {
        discardCapture(current);
        await releaseAudioMode();
        operationInFlightRef.current = false;
        return false;
      }

      current.marks.session = Date.now() - pressedAt;
      phase = "recorder";
      const meterLevels = createLevelMeter();
      const emitter = new LegacyEventEmitter(AudioStudioModule);
      audioSubscriptionRef.current = emitter.addListener<{
        encoded?: string;
        pcmFloat32?: Float32Array | number[];
        buffer?: Float32Array;
      }>("AudioData", (event) => {
        if (!mountedRef.current || captureRef.current !== current) return;
        const audio = event.encoded ?? event.pcmFloat32 ?? event.buffer;
        if (!audio) return;
        const bytes = audioEventToPcm16(audio);
        if (bytes.byteLength === 0) return;
        if (current.firstAudioAt === 0) {
          current.firstAudioAt = Date.now();
          if (__DEV__) {
            current.marks.firstAudio = current.firstAudioAt - current.pressedAt;
            setTimeout(() => {
              console.info(`[dictation] timing ${JSON.stringify(current.marks)}`);
            }, 1500);
          }
        }
        pushDictationLevel(meterLevels(bytes));
        if (current.full) return;
        if (current.live) {
          current.bytes += bytes.byteLength;
          current.live.pacer.send(bytes);
        } else {
          current.chunks.push(bytes);
          current.bytes += bytes.byteLength;
        }
        if (current.bytes < DICTATION_MAX_PCM_BYTES) return;
        current.full = true;
        if (statusRef.current === "recording") void stopRecordingRef.current?.();
      });
      if (prewarmed) {
        await AudioStudioModule.prepareRecording(PREWARMED_START_OPTIONS);
      }
      await AudioStudioModule.startRecording(
        prewarmed ? PREWARMED_START_OPTIONS : DICTATION_RECORDING_OPTIONS,
      );
      if (prewarmed) keepScreenAwakeForDictation(true);
      current.marks.recorder = Date.now() - pressedAt;

      if (!mountedRef.current) {
        await AudioStudioModule.stopRecording().catch(() => undefined);
        keepScreenAwakeForDictation(false);
        releaseClaim();
        discardCapture(current);
        audioSubscriptionRef.current?.remove();
        audioSubscriptionRef.current = null;
        await releaseAudioMode();
        operationInFlightRef.current = false;
        return false;
      }
      phase = "relay";
      current.live?.stream.throwIfFailed();
      cancelledRef.current = false;
      startedAtRef.current = Date.now();
      startDictationMeter(startedAtRef.current);
      tapMedium();
      safeSetStatus("recording");
      operationInFlightRef.current = false;
      if (current.live?.stream.isComplete) void stopRecordingRef.current?.();
      return true;
    } catch (error) {
      console.warn(`[dictation] start failed during ${phase}`, error);
      await AudioStudioModule.stopRecording().catch(() => undefined);
      keepScreenAwakeForDictation(false);
      releaseClaim();
      discardCapture(capture);
      audioSubscriptionRef.current?.remove();
      audioSubscriptionRef.current = null;
      stopDictationMeter();
      await releaseAudioMode();
      operationInFlightRef.current = false;
      if (mountedRef.current) {
        Alert.alert(
          "Voice input",
          phase === "relay" && error instanceof Error && error.message
            ? error.message
            : "Couldn't start recording. Try again in a moment.",
        );
      }
      return false;
    }
  }, [discardCapture, openLive, releaseAudioMode, safeSetStatus]);

  const finalize = useCallback(
    async (commit: boolean): Promise<string | null> => {
      if (statusRef.current !== "recording" || operationInFlightRef.current) {
        return null;
      }
      operationInFlightRef.current = true;
      const durationMs = Date.now() - startedAtRef.current;
      cancelledRef.current = !commit;
      tapLight();
      safeSetStatus(commit ? "transcribing" : "idle");

      let uri: string | null = null;
      try {
        const recording = (await AudioStudioModule.stopRecording()) as {
          fileUri?: string;
        };
        uri = recording.fileUri ?? null;
      } catch (error) {
        console.warn("[dictation] stop failed", error);
      }
      keepScreenAwakeForDictation(false);
      if (claimedRecorderRef.current) {
        claimedRecorderRef.current = false;
        releaseClaimedDictationRecorder();
      }
      const stoppedCapture = captureRef.current;
      if (__DEV__ && stoppedCapture) {
        const heldMs = Date.now() - stoppedCapture.pressedAt;
        const capturedMs = Math.round(stoppedCapture.bytes / 32);
        console.info(
          `[dictation] held ${heldMs}ms captured ${capturedMs}ms missing ${heldMs - capturedMs}ms`,
        );
      }
      await releaseAudioMode();
      audioSubscriptionRef.current?.remove();
      audioSubscriptionRef.current = null;
      const capture = captureRef.current;
      stopDictationMeter();
      await capture?.routed;
      if (captureRef.current === capture) captureRef.current = null;
      const live = capture?.live ?? null;
      live?.pacer.stopPadding();
      if (uri) {
        try {
          new File(uri).delete();
        } catch {
          /* ignore */
        }
      }

      const pcmBytes = capture?.bytes ?? 0;
      const tooShort = live
        ? durationMs < MIN_RECORDING_MS &&
          !live.stream.isComplete &&
          !live.stream.failure
        : pcmBytes < MIN_PCM_BYTES ||
          (durationMs < MIN_RECORDING_MS && !capture?.full);
      if (!commit || !mountedRef.current || tooShort) {
        discardCapture(capture);
        safeSetStatus("idle");
        operationInFlightRef.current = false;
        prewarm();
        return null;
      }

      try {
        let text: string;
        if (live) {
          try {
            text = await finishLive(live);
          } catch (error) {
            const failure =
              live.stream.failure ??
              (error instanceof Error
                ? error
                : new Error("Could not transcribe that audio. Try again."));
            text = live.stream.partialTranscript.trim();
            console.warn("[dictation] transcription failed", failure);
            if (mountedRef.current && !cancelledRef.current) {
              Alert.alert(
                "Voice input",
                text
                  ? `Dictation stopped early. ${failure.message}`
                  : failure.message,
              );
            }
          }
        } else {
          const wav = wavFromPcm16(capture!.chunks, pcmBytes);
          discardCapture(capture);
          text = await transcribeDictationWav(wav);
        }
        if (text && !cancelledRef.current && mountedRef.current) {
          onTranscriptRef.current(text);
          return text;
        }
        return null;
      } catch (error) {
        console.warn("[dictation] transcription failed", error);
        if (mountedRef.current && !cancelledRef.current) {
          Alert.alert(
            "Voice input",
            error instanceof Error && error.message
              ? error.message
              : "Stella couldn't transcribe that recording. Try again.",
          );
        }
        return null;
      } finally {
        discardCapture(capture);
        safeSetStatus("idle");
        operationInFlightRef.current = false;
        prewarm();
      }
    },
    [discardCapture, prewarm, releaseAudioMode, safeSetStatus],
  );

  const stop = useCallback(() => finalize(true), [finalize]);
  const cancel = useCallback(() => finalize(false), [finalize]);
  stopRecordingRef.current = stop;

  useEffect(() => {
    void loadDictationStreamingAvailable()
      .then((available) => (available ? loadDictationRealtimeConfig() : null))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (status === "idle") prewarm();
  }, [prewarm, status]);

  useEffect(() => {
    if (!prewarmEnabled) return;
    prewarm();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        prewarm();
      } else if (next === "background" && statusRef.current === "idle") {
        void releaseDictationRecorderPrewarm();
        releaseWarmDictationSocket();
      }
    });
    return () => {
      subscription.remove();
      if (statusRef.current === "idle" && !operationInFlightRef.current) {
        void releaseDictationRecorderPrewarm();
      }
      releaseWarmDictationSocket();
    };
  }, [prewarm, prewarmEnabled]);

  const toggle = useCallback(async () => {
    if (status === "idle") {
      await start();
    } else if (status === "recording") {
      await stop();
    }
  }, [status, start, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      const ownsRecorder =
        statusRef.current !== "idle" ||
        operationInFlightRef.current ||
        captureRef.current !== null ||
        recordingLeaseRef.current !== null;
      mountedRef.current = false;
      statusRef.current = "idle";
      discardCapture(captureRef.current);
      audioSubscriptionRef.current?.remove();
      audioSubscriptionRef.current = null;
      stopDictationMeter();
      if (ownsRecorder) {
        void AudioStudioModule.stopRecording().catch(() => undefined);
        keepScreenAwakeForDictation(false);
      }
      if (claimedRecorderRef.current) {
        claimedRecorderRef.current = false;
        releaseClaimedDictationRecorder();
      }
      void releaseAudioMode();
    };
  }, [discardCapture, releaseAudioMode]);

  return {
    status,
    isRecording: status === "recording",
    isTranscribing: status === "transcribing",
    start,
    stop,
    cancel,
    toggle,
    prewarm,
  };
}

const audioEventToPcm16 = (
  data: string | Float32Array | Int16Array | number[],
): ArrayBuffer => {
  if (typeof data === "string") {
    const binary = globalThis.atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  if (data instanceof Int16Array) {
    return new Int16Array(data).buffer;
  }
  const pcm = new Int16Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, data[i] ?? 0));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm.buffer;
};

const LEVEL_FRAME_SAMPLES = 128;

const createLevelMeter = () => {
  const meter = createDictationLevelMeter();
  return (bytes: ArrayBuffer): number => {
    const samples = new Int16Array(bytes);
    for (let start = 0; start < samples.length; start += LEVEL_FRAME_SAMPLES) {
      const end = Math.min(samples.length, start + LEVEL_FRAME_SAMPLES);
      let sum = 0;
      for (let i = start; i < end; i += 1) {
        const sample = samples[i]! / 0x8000;
        sum += sample * sample;
      }
      const count = end - start;
      meter.pushRms(Math.sqrt(sum / count), (count * 1000) / DICTATION_SAMPLE_RATE);
    }
    return meter.takeLevel();
  };
};
