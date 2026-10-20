import { Platform } from "react-native";
import { AudioModule } from "expo-audio";
import { AudioStudioModule } from "@siteed/audio-studio";
import { requireOptionalNativeModule } from "expo-modules-core";
import { DICTATION_SAMPLE_RATE } from "./dictation-transcribe";

const BASE_RECORDING_OPTIONS = {
  sampleRate: DICTATION_SAMPLE_RATE,
  channels: 1,
  encoding: "pcm_16bit",
  interval: 80,
  output: { primary: { enabled: false } },
} as const;

export const DICTATION_RECORDING_OPTIONS = {
  ...BASE_RECORDING_OPTIONS,
  keepAwake: true,
};

export const PREWARMED_RECORDING_OPTIONS = {
  ...BASE_RECORDING_OPTIONS,
  keepAwake: false,
  autoResumeAfterInterruption: false,
  ios: {
    audioSession: {
      category: "PlayAndRecord",
      mode: "Default",
      categoryOptions: ["MixWithOthers", "DefaultToSpeaker", "AllowBluetoothA2DP"],
    },
  },
};

/**
 * audio-studio records with the settings it was prepared with, and on iOS
 * `keepAwake: false` pauses the engine when the app backgrounds, which ended
 * dictation for anyone who switched apps mid-sentence. Preparing an already
 * prepared recorder only swaps its settings (the session stays as it is, so
 * nothing ducks), so the tap re-prepares with these before it starts.
 */
export const PREWARMED_START_OPTIONS = {
  ...PREWARMED_RECORDING_OPTIONS,
  keepAwake: true,
};

type KeepAwakeModule = {
  activate(tag: string): Promise<boolean>;
  deactivate(tag: string): Promise<boolean>;
};

const keepAwake = requireOptionalNativeModule<KeepAwakeModule>("ExpoKeepAwake");
const KEEP_AWAKE_TAG = "stella-dictation";

export const keepScreenAwakeForDictation = (awake: boolean): void => {
  if (!keepAwake) return;
  void (awake
    ? keepAwake.activate(KEEP_AWAKE_TAG)
    : keepAwake.deactivate(KEEP_AWAKE_TAG)
  ).catch(() => undefined);
};

type PrewarmState = "idle" | "preparing" | "prepared" | "claimed";

let state: PrewarmState = "idle";
let pending: Promise<void> = Promise.resolve();
let generation = 0;

export const dictationPrewarmSupported = Platform.OS === "ios";

const prepareNow = async (token: number): Promise<void> => {
  const permission = await AudioModule.getRecordingPermissionsAsync().catch(
    () => null,
  );
  if (token !== generation || !permission?.granted) {
    if (token === generation) state = "idle";
    return;
  }
  try {
    await AudioStudioModule.prepareRecording(PREWARMED_RECORDING_OPTIONS);
  } catch {
    if (token === generation) state = "idle";
    return;
  }
  if (token === generation && state === "preparing") {
    state = "prepared";
    return;
  }
  if (state !== "claimed") {
    await AudioStudioModule.stopRecording().catch(() => undefined);
  }
};

export const prewarmDictationRecorder = (): void => {
  if (!dictationPrewarmSupported || state !== "idle") return;
  state = "preparing";
  const token = ++generation;
  pending = pending.then(() => prepareNow(token));
};

export const releaseDictationRecorderPrewarm = (): Promise<void> => {
  if (!dictationPrewarmSupported) return Promise.resolve();
  if (state === "claimed") return pending;
  const wasPrepared = state === "prepared";
  const wasPreparing = state === "preparing";
  generation += 1;
  state = "idle";
  if (!wasPrepared && !wasPreparing) return pending;
  pending = pending.then(async () => {
    if (wasPrepared) {
      await AudioStudioModule.stopRecording().catch(() => undefined);
    }
  });
  return pending;
};

export const claimPreparedDictationRecorder = async (): Promise<boolean> => {
  if (!dictationPrewarmSupported) return false;
  if (state === "preparing") await pending;
  if (state !== "prepared") return false;
  state = "claimed";
  return true;
};

export const releaseClaimedDictationRecorder = (): void => {
  if (state === "claimed") state = "idle";
};
