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

type PlaybackOptions = { background?: boolean };

const playbackMode = (options?: PlaybackOptions): MobileAudioMode =>
  options?.background
    ? { shouldPlayInBackground: true, interruptionMode: "duckOthers" }
    : {};

export const configurePlaybackAudioSession = (options?: PlaybackOptions) =>
  coordinator.configurePlayback(playbackMode(options));

export type PlaybackSessionHold = {
  acquire(options?: PlaybackOptions): Promise<boolean>;
  hold(): boolean;
  release(): void;
};

export const createPlaybackSessionHold = (): PlaybackSessionHold => {
  const holder = Symbol("playback");
  return {
    acquire: (options) => coordinator.acquirePlayback(holder, playbackMode(options)),
    hold: () => coordinator.holdPlayback(holder),
    release: () => {
      void coordinator.releasePlayback(holder).catch(() => undefined);
    },
  };
};

export type { RecordingAudioLease } from "./audio-session-coordinator";
