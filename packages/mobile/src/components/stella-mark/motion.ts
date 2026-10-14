import {
  WORKING_DOTS_CYCLE_MS,
  WORKING_DOTS_STAGGER,
  sampleWorkingDots,
} from "@stella/contracts/working-dots-bounce";

export const DOT_RADIUS_UNITS = 22;

export const DOT_SPREAD_UNITS = 62;

export const SIDE_DOT_SCALE = 1.02;

const BOUNCE_FRAMES = sampleWorkingDots();
const BOUNCE_LIFT = BOUNCE_FRAMES.map((f) => f.lift);
const BOUNCE_SCALE_X = BOUNCE_FRAMES.map((f) => f.scaleX);
const BOUNCE_SCALE_Y = BOUNCE_FRAMES.map((f) => f.scaleY);
const BOUNCE_LAST = BOUNCE_FRAMES.length - 1;
const TWO_PI = Math.PI * 2;

export const DOT_BOUNCE_ENTRY_MS = 260;

export type DotBounce = {
  lift: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};

export function dotBounce(
  slot: number,
  timeMs: number,
  reduced: boolean,
): DotBounce {
  "worklet";
  const local =
    (timeMs -
      DOT_BOUNCE_ENTRY_MS -
      slot * WORKING_DOTS_STAGGER * WORKING_DOTS_CYCLE_MS) /
    WORKING_DOTS_CYCLE_MS;
  const phase = local <= 0 ? 0 : local - Math.floor(local);
  if (reduced) {
    const k = 0.5 - 0.5 * Math.cos(phase * TWO_PI);
    return { lift: 0, scaleX: 1, scaleY: 1, opacity: 0.55 + 0.45 * k };
  }
  const at = phase * BOUNCE_LAST;
  const i = Math.min(Math.floor(at), BOUNCE_LAST - 1);
  const t = at - i;
  return {
    lift: BOUNCE_LIFT[i] + (BOUNCE_LIFT[i + 1] - BOUNCE_LIFT[i]) * t,
    scaleX: BOUNCE_SCALE_X[i] + (BOUNCE_SCALE_X[i + 1] - BOUNCE_SCALE_X[i]) * t,
    scaleY: BOUNCE_SCALE_Y[i] + (BOUNCE_SCALE_Y[i + 1] - BOUNCE_SCALE_Y[i]) * t,
    opacity: 1,
  };
}

export const BREATHE_MS = 4000;

export const BREATHE_AMPLITUDE = 0.013;

export type ToolCharacterMotionState =
  | "working"
  | "writing"
  | "searching"
  | "reading";

export const CLOCK_SPAN_MS = 3_000_000;

export const VOICE_PULSE_GAIN = 0.22;

export function clamp01(value: number): number {
  "worklet";
  if (!Number.isFinite(value)) return 0;
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

export function breatheScale(timeMs: number, amplitude: number): number {
  "worklet";
  return 1 + amplitude * Math.sin((timeMs / BREATHE_MS) * 2 * Math.PI);
}

export function voiceScale(energy: number, timeMs: number): number {
  "worklet";
  const level = clamp01(energy);
  return (
    breatheScale(timeMs, BREATHE_AMPLITUDE * (1 - level)) *
    (1 + VOICE_PULSE_GAIN * level)
  );
}
