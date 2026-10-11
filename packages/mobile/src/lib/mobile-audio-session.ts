import { setAudioModeAsync, setIsAudioActiveAsync } from "expo-audio";
import {
  AudioSessionCoordinator,
  type MobileAudioMode,
  type RecordingAudioLease,
} from "./audio-session-coordinator";

const coordinator = new AudioSessionCoordinator(setAudioModeAsync, () =>
  setIsAudioActiveAsync(false),
);

export const acquireRecordingAudioSession = (mode?: MobileAudioMode) =>
  coordinator.acquireRecording(mode);

export const refreshRecordingAudioSession = (
  lease: RecordingAudioLease,
  mode: MobileAudioMode,
) => coordinator.refreshRecording(lease, mode);

export const releaseRecordingAudioSession = (lease: RecordingAudioLease) =>
  coordinator.releaseRecording(lease);

export const configurePlaybackAudioSession = (options?: { background?: boolean }) =>
  coordinator.configurePlayback(
    options?.background
      ? { shouldPlayInBackground: true, interruptionMode: "duckOthers" }
      : {},
  );

export const releasePlaybackAudioSession = () => coordinator.releasePlayback();

export type { RecordingAudioLease } from "./audio-session-coordinator";
