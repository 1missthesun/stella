import { setAudioModeAsync, setIsAudioActiveAsync } from "expo-audio";
import {
  AudioSessionCoordinator,
  type MobileAudioMode,
  type RecordingAudioLease,
} from "./audio-session-coordinator";
import {
  prewarmDictationRecorder,
  releaseDictationRecorderPrewarm,
} from "./dictation-prewarm";

const coordinator = new AudioSessionCoordinator(setAudioModeAsync, () =>
  setIsAudioActiveAsync(false),
);

const playbackHolders = new Set<symbol>();
let recordingLeases = 0;

const trackRecording = async (
  lease: Promise<RecordingAudioLease | null>,
): Promise<RecordingAudioLease | null> => {
  const value = await lease;
  if (value !== null) recordingLeases += 1;
  return value;
};

export const acquireRecordingAudioSession = (
  mode?: MobileAudioMode,
  options: { prewarmed?: boolean } = {},
) =>
  options.prewarmed
    ? trackRecording(coordinator.acquireRecording(mode, { apply: false }))
    : releaseDictationRecorderPrewarm().then(() =>
        trackRecording(coordinator.acquireRecording(mode)),
      );

export const prewarmDictationAudioSession = (): void => {
  if (playbackHolders.size > 0 || recordingLeases > 0) return;
  prewarmDictationRecorder();
};

export const refreshRecordingAudioSession = (
  lease: RecordingAudioLease,
  mode: MobileAudioMode,
) => coordinator.refreshRecording(lease, mode);

export const releaseRecordingAudioSession = (lease: RecordingAudioLease) => {
  recordingLeases = Math.max(0, recordingLeases - 1);
  return coordinator.releaseRecording(lease);
};

type PlaybackOptions = { background?: boolean };

const playbackMode = (options?: PlaybackOptions): MobileAudioMode =>
  options?.background
    ? { shouldPlayInBackground: true, interruptionMode: "duckOthers" }
    : {};

export const configurePlaybackAudioSession = (options?: PlaybackOptions) =>
  releaseDictationRecorderPrewarm().then(() =>
    coordinator.configurePlayback(playbackMode(options)),
  );

export type PlaybackSessionHold = {
  acquire(options?: PlaybackOptions): Promise<boolean>;
  hold(): boolean;
  release(): void;
};

export const createPlaybackSessionHold = (): PlaybackSessionHold => {
  const holder = Symbol("playback");
  return {
    acquire: (options) => {
      playbackHolders.add(holder);
      return releaseDictationRecorderPrewarm().then(() =>
        coordinator.acquirePlayback(holder, playbackMode(options)),
      );
    },
    hold: () => {
      const held = coordinator.holdPlayback(holder);
      if (held) {
        playbackHolders.add(holder);
        void releaseDictationRecorderPrewarm();
      }
      return held;
    },
    release: () => {
      playbackHolders.delete(holder);
      void coordinator.releasePlayback(holder).catch(() => undefined);
    },
  };
};

export type { RecordingAudioLease } from "./audio-session-coordinator";
