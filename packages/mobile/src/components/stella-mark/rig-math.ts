import { Easing } from "react-native-reanimated";

export const TAU = Math.PI * 2;

export type Spring = { x: number; v: number; t: number };

export function clamp(value: number, low: number, high: number): number {
  "worklet";
  return value < low ? low : value > high ? high : value;
}

export function easeInOutCubic(t: number): number {
  "worklet";
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubicRaw(t: number): number {
  "worklet";
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBackRaw(t: number): number {
  "worklet";
  return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
}

export function smoothstep(t: number): number {
  "worklet";
  return t * t * (3 - 2 * t);
}

export function randomIn(low: number, high: number): number {
  "worklet";
  return low + Math.random() * (high - low);
}

export function stepSpring(s: Spring, w: number, z: number, dt: number): void {
  "worklet";
  s.v += (-2 * z * w * s.v - w * w * (s.x - s.t)) * dt;
  s.x += s.v * dt;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) {
    s.x = s.t;
    s.v = 0;
  }
}

export function r2(value: number): number {
  "worklet";
  return Math.round(value * 100) / 100;
}

export function ringPath(xs: readonly number[], ys: readonly number[]): string {
  "worklet";
  const n = xs.length;
  let d = "M" + r2(xs[0]) + " " + r2(ys[0]);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const c = (i + 1) % n;
    const e = (i + 2) % n;
    d +=
      "C" +
      r2(xs[i] + (xs[c] - xs[a]) / 6) +
      " " +
      r2(ys[i] + (ys[c] - ys[a]) / 6) +
      " " +
      r2(xs[c] - (xs[e] - xs[i]) / 6) +
      " " +
      r2(ys[c] - (ys[e] - ys[i]) / 6) +
      " " +
      r2(xs[c]) +
      " " +
      r2(ys[c]);
  }
  return d + "Z";
}

export function spanAt(
  xs: readonly number[],
  ys: readonly number[],
  y: number,
  cx: number,
  out: number[],
): void {
  "worklet";
  let left = -Infinity;
  let right = Infinity;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (ys[i] <= y === ys[j] <= y) continue;
    const x = xs[i] + ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]);
    if (x <= cx) {
      if (x > left) left = x;
    } else if (x < right) right = x;
  }
  out[0] = Number.isFinite(left) ? left : cx;
  out[1] = Number.isFinite(right) ? right : cx;
}

export const cssEaseInOut = Easing.bezierFn(0.42, 0, 0.58, 1);

export const releaseEase = Easing.bezierFn(0.22, 1, 0.36, 1);

export const enterEase = Easing.bezierFn(0.22, 1, 0.36, 1);

export const exitEase = Easing.bezierFn(0.4, 0, 0.7, 1);
