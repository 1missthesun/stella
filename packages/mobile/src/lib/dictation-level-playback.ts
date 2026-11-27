import { DICTATION_LEVEL_WINDOW_MS } from "@stella/contracts/dictation-waveform";

export type DictationLevelBatch = {
  seq: number;
  levels: number[];
};

export type DictationLevelPlayback = DictationLevelBatch & {
  startedAt: number;
  played: number;
  level: number;
};

export const createDictationLevelPlayback = (): DictationLevelPlayback => ({
  seq: 0,
  levels: [],
  startedAt: 0,
  played: 0,
  level: 0,
});

/**
 * The recorder delivers audio in batches (about 100 ms on iOS, 80 ms on
 * Android) that are already in the past on arrival. Each batch's levels play
 * at recorded pace from its arrival; a batch arriving early folds what was
 * left of the previous one into its first level, so playback never falls
 * behind the microphone.
 */
export function stepDictationLevelPlayback(
  playback: DictationLevelPlayback,
  nowMs: number,
  batch: DictationLevelBatch,
): void {
  "worklet";
  let peak = -1;
  if (batch.seq !== playback.seq) {
    for (let i = playback.played; i < playback.levels.length; i += 1) {
      peak = Math.max(peak, playback.levels[i] ?? 0);
    }
    playback.seq = batch.seq;
    playback.levels = batch.levels;
    playback.startedAt = nowMs;
    playback.played = 0;
  }
  const due = Math.min(
    playback.levels.length,
    Math.floor((nowMs - playback.startedAt) / DICTATION_LEVEL_WINDOW_MS) + 1,
  );
  for (; playback.played < due; playback.played += 1) {
    peak = Math.max(peak, playback.levels[playback.played] ?? 0);
  }
  if (peak >= 0) playback.level = peak;
}
