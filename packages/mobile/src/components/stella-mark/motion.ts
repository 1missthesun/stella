/**
 * Pure motion math for the character mark, kept out of the component.
 *
 * Every function here is a Reanimated worklet: the mark evaluates them on the
 * UI thread from one shared clock, so no per-frame work ever crosses to JS.
 * They are plain arithmetic, which is exactly what makes them worklet-safe and
 * directly callable from a test.
 *
 * All distances are in viewBox units of `geometry.ts`
 * (`STELLA_MARK_VIEWBOX`, centre `STELLA_MARK_CENTER`), matching the approved
 * desktop rig one-for-one. Turning those units into pixels is `layout.ts`.
 */

import {
  WORKING_DOTS_CYCLE_MS,
  WORKING_DOTS_STAGGER,
  sampleWorkingDots,
} from "@stella/contracts/working-dots-bounce";

/** Radius of a thinking dot, in viewBox units. */
export const DOT_RADIUS_UNITS = 22;

/** Horizontal offset of the side dots from centre, in viewBox units. */
export const DOT_SPREAD_UNITS = 62;

/** Side dots read a touch larger than the middle one. */
export const SIDE_DOT_SCALE = 1.02;

const BOUNCE_FRAMES = sampleWorkingDots();
const BOUNCE_LIFT = BOUNCE_FRAMES.map((f) => f.lift);
const BOUNCE_SCALE_X = BOUNCE_FRAMES.map((f) => f.scaleX);
const BOUNCE_SCALE_Y = BOUNCE_FRAMES.map((f) => f.scaleY);
const BOUNCE_OPACITY = BOUNCE_FRAMES.map((f) => f.opacity);
const BOUNCE_LAST = BOUNCE_FRAMES.length - 1;
const TWO_PI = Math.PI * 2;

/** The first crouch waits for the star to have mostly become the orb. */
export const DOT_BOUNCE_ENTRY_MS = 260;

export type DotBounce = {
  /** Rise in dot diameters. */
  lift: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};

/**
 * Bounce of slot `i` at `timeMs`, read off the shared curve
 * (`@stella/contracts/working-dots-bounce`) the desktop plays as WAAPI
 * keyframes. The curve is tabulated once on the JS thread and interpolated
 * here, so both platforms draw exactly the same hop. Before a slot's first
 * hop it holds the resting frame. Scales are about the dot's bottom edge.
 * Under reduced motion only the opacity breathes.
 */
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
    opacity:
      BOUNCE_OPACITY[i] + (BOUNCE_OPACITY[i + 1] - BOUNCE_OPACITY[i]) * t,
  };
}

/** Period of the resting breathe. */
export const BREATHE_MS = 4000;

/** Resting breathe depth: ±1.3% is visible without reading as a pulse. */
export const BREATHE_AMPLITUDE = 0.013;

export type ToolCharacterMotionState =
  | "working"
  | "writing"
  | "searching"
  | "reading";

/**
 * Length of the linear clock ramp every periodic term reads. A common multiple
 * of the bounce cycle (1500ms) and the breathe period (4000ms), so the wrap is
 * seamless for both; at 50 minutes it is far outside any single activation.
 */
export const CLOCK_SPAN_MS = 3_000_000;

/** How much full mic/output energy inflates the mark over its resting size. */
export const VOICE_PULSE_GAIN = 0.22;

export function clamp01(value: number): number {
  "worklet";
  if (!Number.isFinite(value)) return 0;
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/** Resting breathe: a slow sine on the clock, in scale units. */
export function breatheScale(timeMs: number, amplitude: number): number {
  "worklet";
  return 1 + amplitude * Math.sin((timeMs / BREATHE_MS) * 2 * Math.PI);
}

/**
 * Scale for a voice-driven mark. Live energy takes over from the breathe
 * rather than beating against it: the breathe fades out as the level rises, so
 * a loud moment reads as one clean pulse instead of two overlapping rhythms.
 */
export function voiceScale(energy: number, timeMs: number): number {
  "worklet";
  const level = clamp01(energy);
  return (
    breatheScale(timeMs, BREATHE_AMPLITUDE * (1 - level)) *
    (1 + VOICE_PULSE_GAIN * level)
  );
}
