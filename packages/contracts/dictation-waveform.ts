// "worklet" lets mobile run these on the UI thread; elsewhere it is a no-op.

export const DICTATION_WAVEFORM_BAR_WIDTH = 3;
export const DICTATION_WAVEFORM_BAR_GAP = 3;
export const DICTATION_WAVEFORM_STRIDE =
  DICTATION_WAVEFORM_BAR_WIDTH + DICTATION_WAVEFORM_BAR_GAP;
export const DICTATION_WAVEFORM_BAR_MS = 70;
export const DICTATION_WAVEFORM_CAPACITY = 160;

const ATTACK_MS = 18;
const RELEASE_MS = 90;
const FADE_FRACTION = 0.38;
const FADE_MIN_OPACITY = 0.18;
const FADE_MIN_SCALE = 0.7;

const WINDOW_MS = 20;
const SILENCE_DB = -100;
const FLOOR_MIN_DB = -58;
const FLOOR_ABOVE_NOISE_DB = 7;
const NOISE_RISE_DB_PER_S = 3;
const REF_START_DB = -16;
const REF_MIN_DB = -22;
const REF_MAX_DB = -8;
const REF_DECAY_DB_PER_S = 1.5;
const MIN_SPAN_DB = 22;
const HEADROOM_DB = 3;
const CURVE = 1.35;

export type DictationLevelMeter = {
  pushRms: (rms: number, durationMs: number) => void;
  takeLevel: () => number;
  reset: () => void;
};

export function createDictationLevelMeter(): DictationLevelMeter {
  let energy = 0;
  let windowMs = 0;
  let noiseDb = FLOOR_MIN_DB - FLOOR_ABOVE_NOISE_DB;
  let refDb = REF_START_DB;
  let latest = 0;
  let peak = 0;

  const commitWindow = () => {
    const rms = Math.sqrt(energy / windowMs);
    const seconds = windowMs / 1000;
    energy = 0;
    windowMs = 0;
    const db = rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;

    noiseDb =
      db < noiseDb
        ? db
        : Math.min(db, noiseDb + NOISE_RISE_DB_PER_S * seconds);
    refDb = Math.min(
      REF_MAX_DB,
      Math.max(REF_MIN_DB, db, refDb - REF_DECAY_DB_PER_S * seconds),
    );
    const top = refDb + HEADROOM_DB;
    const floor = Math.min(
      top - MIN_SPAN_DB,
      Math.max(FLOOR_MIN_DB, noiseDb + FLOOR_ABOVE_NOISE_DB),
    );
    const x = (db - floor) / (top - floor);
    latest = x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(x, CURVE);
    if (latest > peak) peak = latest;
  };

  return {
    pushRms(rms, durationMs) {
      if (!(durationMs > 0) || !Number.isFinite(rms)) return;
      energy += rms * rms * durationMs;
      windowMs += durationMs;
      if (windowMs >= WINDOW_MS) commitWindow();
    },
    takeLevel() {
      const level = peak;
      peak = latest;
      return level;
    },
    reset() {
      energy = 0;
      windowMs = 0;
      noiseDb = FLOOR_MIN_DB - FLOOR_ABOVE_NOISE_DB;
      refDb = REF_START_DB;
      latest = 0;
      peak = 0;
    },
  };
}

export type DictationWaveformState = {
  bars: number[];
  head: number;
  count: number;
  live: number;
  forming: number;
  barStartedAt: number;
  steppedAt: number;
  progress: number;
};

export function createDictationWaveformState(): DictationWaveformState {
  return {
    bars: new Array<number>(DICTATION_WAVEFORM_CAPACITY).fill(0),
    head: 0,
    count: 0,
    live: 0,
    forming: 0,
    barStartedAt: -1,
    steppedAt: -1,
    progress: 0,
  };
}

export function stepDictationWaveform(
  state: DictationWaveformState,
  nowMs: number,
  target: number,
): void {
  "worklet";
  if (state.steppedAt < 0) {
    state.steppedAt = nowMs;
    state.barStartedAt = nowMs;
  }
  const dt = Math.max(0, Math.min(100, nowMs - state.steppedAt));
  state.steppedAt = nowMs;
  const goal = target < 0 ? 0 : target > 1 ? 1 : target;
  const tau = goal > state.live ? ATTACK_MS : RELEASE_MS;
  state.live += (goal - state.live) * (1 - Math.exp(-dt / tau));
  if (state.live > state.forming) state.forming = state.live;

  let elapsed = nowMs - state.barStartedAt;
  if (elapsed > DICTATION_WAVEFORM_BAR_MS * 4) {
    state.barStartedAt = nowMs - DICTATION_WAVEFORM_BAR_MS;
    elapsed = DICTATION_WAVEFORM_BAR_MS;
  }
  while (elapsed >= DICTATION_WAVEFORM_BAR_MS) {
    state.head = (state.head + 1) % DICTATION_WAVEFORM_CAPACITY;
    state.bars[state.head] = state.forming;
    if (state.count < DICTATION_WAVEFORM_CAPACITY) state.count += 1;
    state.forming = state.live;
    state.barStartedAt += DICTATION_WAVEFORM_BAR_MS;
    elapsed -= DICTATION_WAVEFORM_BAR_MS;
  }
  state.progress = elapsed / DICTATION_WAVEFORM_BAR_MS;
}

// Bar at `age` 0 is the one still forming at the leading (right) edge; age k
// is the k-th finished bar behind it. Returns null when there is no such bar.
export function dictationWaveformLevel(
  state: DictationWaveformState,
  age: number,
): number | null {
  "worklet";
  if (age === 0) return state.forming;
  if (age > state.count) return null;
  const index =
    (state.head - (age - 1) + DICTATION_WAVEFORM_CAPACITY) %
    DICTATION_WAVEFORM_CAPACITY;
  return state.bars[index] ?? 0;
}

// Distance in px from the waveform's right edge to the bar's right side.
export function dictationWaveformOffset(
  state: DictationWaveformState,
  age: number,
): number {
  "worklet";
  return (age + state.progress) * DICTATION_WAVEFORM_STRIDE;
}

export function dictationWaveformBarCount(width: number): number {
  "worklet";
  return Math.min(
    DICTATION_WAVEFORM_CAPACITY,
    Math.max(1, Math.ceil(width / DICTATION_WAVEFORM_STRIDE) + 1),
  );
}

export type DictationWaveformBarLook = {
  height: number;
  opacity: number;
};

// Height in px for a level, with a round dot at silence, and the fade toward
// the older (left) end, where `offset` is from dictationWaveformOffset.
export function dictationWaveformBarLook(
  level: number,
  offset: number,
  width: number,
  maxHeight: number,
): DictationWaveformBarLook {
  "worklet";
  const fadeSpan = Math.max(1, width * FADE_FRACTION);
  const fromLeft = width - offset;
  const t = fromLeft >= fadeSpan ? 1 : fromLeft <= 0 ? 0 : fromLeft / fadeSpan;
  const eased = t * t * (3 - 2 * t);
  const base = DICTATION_WAVEFORM_BAR_WIDTH;
  const scale = FADE_MIN_SCALE + (1 - FADE_MIN_SCALE) * eased;
  return {
    height: base + (maxHeight - base) * level * scale,
    opacity: FADE_MIN_OPACITY + (1 - FADE_MIN_OPACITY) * eased,
  };
}
