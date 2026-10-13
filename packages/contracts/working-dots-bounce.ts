/**
 * The thinking ellipsis' bounce, shared by desktop and the phone so both dots
 * move on the same curve.
 *
 * Each dot crouches, launches stretched, rounds out at the top of a parabolic
 * hop, falls stretched, splats on the floor and settles with a damped wobble.
 * The three dots run the same loop a fixed fraction of a cycle apart, so the
 * hop reads as one wave travelling along the row.
 *
 * The dots stay fully lit throughout: only their shape and height move.
 *
 * Everything is a function of the loop phase alone and returns exactly the
 * resting frame at both ends, so the loop has no seam. Scales are about the
 * dot's bottom edge and keep its area: `scaleX · scaleY = 1`. Lift is in dot
 * diameters, so each surface converts it to its own units.
 *
 * Platforms sample this once into a table (WAAPI keyframes on desktop, a
 * worklet lookup on the phone) rather than evaluating it per frame.
 */

export const WORKING_DOTS_CYCLE_MS = 1500;

/** Cycle fraction between neighbouring dots, left to right. */
export const WORKING_DOTS_STAGGER = 0.11;

/** Peak hop, in dot diameters. */
export const WORKING_DOTS_LIFT = 0.9;

/** Samples per cycle when a platform tabulates the curve. */
export const WORKING_DOTS_SAMPLES = 150;

const CROUCH_END = 0.1;
const TAKEOFF = 0.15;
const LAND = 0.47;
const SPLAT_PEAK = 0.49;
const SETTLE_FROM = 0.66;
const SETTLE_TO = 0.8;

const CROUCH = 0.82;
const LAUNCH_STRETCH = 1.22;
const FALL_STRETCH = 1.17;
const SPLAT = 0.72;
const WOBBLE_PERIOD = 0.12;
const WOBBLE_DECAY = 23;

const TAU = Math.PI * 2;

export type WorkingDotsFrame = {
  lift: number;
  scaleX: number;
  scaleY: number;
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

function squashAt(p: number): number {
  if (p < CROUCH_END) return 1 + (CROUCH - 1) * smoothstep(p / CROUCH_END);
  if (p < TAKEOFF) {
    const k = smoothstep((p - CROUCH_END) / (TAKEOFF - CROUCH_END));
    return CROUCH + (LAUNCH_STRETCH - CROUCH) * k;
  }
  if (p < LAND) {
    const u = (p - TAKEOFF) / (LAND - TAKEOFF);
    const speed = Math.pow(Math.abs(1 - 2 * u), 1.6);
    const stretch = u < 0.5 ? LAUNCH_STRETCH : FALL_STRETCH;
    return 1 + (stretch - 1) * speed;
  }
  if (p < SPLAT_PEAK) {
    const k = easeOutCubic((p - LAND) / (SPLAT_PEAK - LAND));
    return FALL_STRETCH + (SPLAT - FALL_STRETCH) * k;
  }
  const tau = p - SPLAT_PEAK;
  const w = TAU / WOBBLE_PERIOD;
  const spring =
    Math.exp(-WOBBLE_DECAY * tau) *
    (Math.cos(w * tau) + (WOBBLE_DECAY / w) * Math.sin(w * tau));
  const settle = 1 - smoothstep((p - SETTLE_FROM) / (SETTLE_TO - SETTLE_FROM));
  return 1 - (1 - SPLAT) * spring * settle;
}

function liftAt(p: number): number {
  if (p <= TAKEOFF || p >= LAND) return 0;
  const u = (p - TAKEOFF) / (LAND - TAKEOFF);
  return 4 * WORKING_DOTS_LIFT * u * (1 - u);
}

/** The bounce at loop phase `p` (any real; wrapped into 0..1). */
export function workingDotsFrame(p: number): WorkingDotsFrame {
  const phase = ((p % 1) + 1) % 1;
  const scaleY = squashAt(phase);
  return {
    lift: liftAt(phase),
    scaleX: 1 / scaleY,
    scaleY,
  };
}

/** `WORKING_DOTS_SAMPLES + 1` evenly spaced frames, first and last both rest. */
export function sampleWorkingDots(
  samples = WORKING_DOTS_SAMPLES,
): WorkingDotsFrame[] {
  return Array.from({ length: samples + 1 }, (_, i) =>
    workingDotsFrame(i === samples ? 0 : i / samples),
  );
}

/** The reduced-motion stand-in: a slow opacity breath, no movement. */
export function workingDotsReducedOpacity(p: number): number {
  const phase = ((p % 1) + 1) % 1;
  const k = 0.5 - 0.5 * Math.cos(phase * TAU);
  return 0.55 + 0.45 * k;
}
