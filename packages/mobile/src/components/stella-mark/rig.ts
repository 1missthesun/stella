import {
  WORKING_DOTS_CYCLE_MS,
  WORKING_DOTS_STAGGER,
} from "@stella/contracts/working-dots-bounce";
import {
  STELLA_MARK_CENTER,
  STELLA_RING_N,
  STELLA_STAR_FACE,
  STELLA_STAR_PROFILE,
} from "./geometry";
import { buildEyePoses, type EyePoseName } from "./face";
import { DOT_BOUNCE_ENTRY_MS, DOT_RADIUS_UNITS, dotBounce } from "./motion";
import {
  TAU,
  clamp,
  cssEaseInOut,
  easeInOutCubic,
  randomIn,
  releaseEase,
  ringPath,
  smoothstep,
  spanAt,
  stepSpring,
  type Spring,
} from "./rig-math";
import type { WorkingIndicatorCharacterState } from "../working-indicator-character";

export type RigActivity = "dots" | "twinkle" | "orbit";

export type RigInput = {
  state: WorkingIndicatorCharacterState;
  paused: boolean;
  reduced: boolean;
  smallness: number;
};

export type RigDots = {
  w: number;
  z: number;
  bodyScale: number;
  hop: number[];
};

export type RigOut = {
  bodyD: string;
  matrix: number[];
  eyeL: string;
  eyeR: string;
  sparkD: string[];
  sparkO: number[];
  dots: RigDots;
  bodyDirty: boolean;
  matrixDirty: boolean;
  eyesDirty: boolean;
  sparksDirty: boolean;
  dotsDirty: boolean;
};

export type RigState = {
  state: WorkingIndicatorCharacterState;
  activity: RigActivity | null;
  prev: RigActivity | null;
  activityStart: number;
  dotsStart: number;
  releaseAt: number;
  release: number[];
  clock: number;
  env: Spring;
  fade: Spring;
  blink: Spring;
  bobX: Spring;
  bobY: Spring;
  breathe: Spring;
  poseFrom: number[];
  poseCur: EyePoseName;
  poseMix: number;
  poseDur: number;
  poseAt: number;
  poseIdx: number;
  nextPoseAt: number;
  nextBlinkAt: number;
  blinkReleaseAt: number;
  radii: number[];
  lx: number[];
  ly: number[];
  span: number[];
  sparksShown: boolean;
  dotsIdle: boolean;
  out: RigOut;
};

const C = STELLA_MARK_CENTER;
const N = STELLA_RING_N;
const EYE_N = 48;

const MORPH_END = 0.62;
const ENV_W = 14;
const ENV_Z = 1;
const FADE_W = 11;
const FADE_Z = 1;
const SUBSTEP = 1 / 120;
const DOTS_ZOOM = 1.5;
const ZOOM_SMALL_PX = 44;
const ZOOM_LARGE_PX = 134;
const BOUNCE_RELEASE_MS = 220;
const SPARK_COUNT = 5;
const ORBIT_RX = C * 1.02;
const ORBIT_RY = C * 0.42;
const SPARK_SIZE = 17;

const RING_COS: number[] = [];
const RING_SIN: number[] = [];
const RING_SHIMMER_SIN: number[] = [];
const RING_SHIMMER_COS: number[] = [];
const ORB_XS: number[] = [];
const ORB_YS: number[] = [];
for (let i = 0; i < N; i++) {
  const th = (i / N) * TAU;
  RING_COS.push(Math.cos(th));
  RING_SIN.push(Math.sin(th));
  RING_SHIMMER_SIN.push(Math.sin(th * 3));
  RING_SHIMMER_COS.push(Math.cos(th * 3));
  ORB_XS.push(C + Math.cos(th) * C);
  ORB_YS.push(C + Math.sin(th) * C);
}
const STAR_PROFILE = STELLA_STAR_PROFILE.slice();
const ORB_D = ringPath(ORB_XS, ORB_YS);

const SPARK_UX: number[] = [];
const SPARK_UY: number[] = [];
for (let i = 0; i < 8; i++) {
  const a = -Math.PI / 2 + (i * TAU) / 8;
  const r = i % 2 === 0 ? 1 : 0.19;
  SPARK_UX.push(Number((Math.cos(a) * r).toFixed(3)));
  SPARK_UY.push(Number((Math.sin(a) * r).toFixed(3)));
}

const EYE_FLAT: Record<EyePoseName, number[]> = (() => {
  const poses = buildEyePoses(EYE_N);
  const flat = {} as Record<EyePoseName, number[]>;
  for (const name of Object.keys(poses) as EyePoseName[]) {
    const pts: number[] = [];
    for (const [x, y] of poses[name]) pts.push(x, y);
    flat[name] = pts;
  }
  return flat;
})();

const ACTIVITY_OF: Record<WorkingIndicatorCharacterState, RigActivity> = {
  thinking: "dots",
  working: "twinkle",
  writing: "twinkle",
  searching: "orbit",
  reading: "orbit",
};

const BODY_R: Record<RigActivity, number> = {
  dots: DOT_RADIUS_UNITS,
  twinkle: C,
  orbit: C * 0.9,
};

const POSES: Record<WorkingIndicatorCharacterState, EyePoseName[]> = {
  thinking: ["squint", "focus", "curious", "neutral"],
  working: ["focus", "squint", "neutral"],
  writing: ["focus", "neutral"],
  searching: ["focus", "curious", "wide", "neutral"],
  reading: ["focus", "squint"],
};

const POSE_EVERY: Record<WorkingIndicatorCharacterState, number[]> = {
  thinking: [2000, 3600],
  working: [1800, 3200],
  writing: [2400, 4200],
  searching: [1000, 1800],
  reading: [2200, 3800],
};

const BLINK_EVERY: Record<WorkingIndicatorCharacterState, number[]> = {
  thinking: [3500, 7000],
  working: [2800, 5500],
  writing: [3000, 6000],
  searching: [1600, 4000],
  reading: [3000, 6000],
};

const FACE_TUNE: Record<WorkingIndicatorCharacterState, number[]> = {
  thinking: [0.97, 0.98, 0.94],
  working: [0.98, 1, 0.96],
  writing: [0.96, 0.98, 0.95],
  searching: [1.02, 1.02, 1],
  reading: [0.96, 0.96, 0.98],
};

const FACE_DX = STELLA_STAR_FACE.dx;
const FACE_DY = STELLA_STAR_FACE.dy;
const FACE_RX = STELLA_STAR_FACE.rx;
const FACE_RY = STELLA_STAR_FACE.ry;

const REST_HOP = [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1];

const EMPTY_D = "M0 0";

export function rigSmallness(sizePx: number): number {
  "worklet";
  return (
    1 -
    smoothstep(
      clamp((sizePx - ZOOM_SMALL_PX) / (ZOOM_LARGE_PX - ZOOM_SMALL_PX), 0, 1),
    )
  );
}

export function rigMaxZoom(sizePx: number): number {
  "worklet";
  return 1 + (DOTS_ZOOM - 1) * rigSmallness(sizePx);
}

function spring(value: number): Spring {
  "worklet";
  return { x: value, v: 0, t: value };
}

function currentPose(rig: RigState): number[] {
  "worklet";
  const cur = EYE_FLAT[rig.poseCur];
  if (rig.poseMix >= 1) return cur;
  const m = easeInOutCubic(rig.poseMix);
  const from = rig.poseFrom;
  const pts: number[] = [];
  for (let i = 0; i < cur.length; i++)
    pts.push(from[i] + (cur[i] - from[i]) * m);
  return pts;
}

function setPose(rig: RigState, name: EyePoseName, dur: number): void {
  "worklet";
  if (name === rig.poseCur && rig.poseMix >= 1) return;
  rig.poseFrom = currentPose(rig);
  rig.poseCur = name;
  rig.poseMix = 0;
  rig.poseDur = dur;
  rig.poseAt = rig.clock;
}

function scheduleFace(rig: RigState, now: number): void {
  "worklet";
  const every = POSE_EVERY[rig.state];
  rig.nextPoseAt = now + randomIn(every[0], every[1]);
  const blink = BLINK_EVERY[rig.state];
  rig.nextBlinkAt = now + randomIn(blink[0], blink[1]);
}

function hopSlot(
  rig: RigState,
  slot: number,
  reduced: boolean,
  out: number[],
): void {
  "worklet";
  const o = slot * 4;
  if (rig.activity === "dots") {
    const local = rig.clock - rig.dotsStart;
    const delay =
      DOT_BOUNCE_ENTRY_MS + slot * WORKING_DOTS_STAGGER * WORKING_DOTS_CYCLE_MS;
    if (local < delay) {
      const first = dotBounce(slot, 0, reduced);
      out[o] = 0;
      out[o + 1] = 1;
      out[o + 2] = 1;
      out[o + 3] =
        1 + (first.opacity - 1) * cssEaseInOut(clamp(local / delay, 0, 1));
      return;
    }
    const f = dotBounce(slot, local, reduced);
    out[o] = f.lift;
    out[o + 1] = f.scaleX;
    out[o + 2] = f.scaleY;
    out[o + 3] = f.opacity;
    return;
  }
  if (rig.releaseAt >= 0) {
    const p = (rig.clock - rig.releaseAt) / BOUNCE_RELEASE_MS;
    if (p < 1) {
      const q = releaseEase(clamp(p, 0, 1));
      for (let k = 0; k < 4; k++) {
        const from = rig.release[o + k];
        out[o + k] = from + (REST_HOP[o + k] - from) * q;
      }
      return;
    }
  }
  out[o] = 0;
  out[o + 1] = 1;
  out[o + 2] = 1;
  out[o + 3] = 1;
}

function applyState(
  rig: RigState,
  next: WorkingIndicatorCharacterState,
  reduced: boolean,
): void {
  "worklet";
  if (next === rig.state) return;
  rig.state = next;
  const nextActivity = ACTIVITY_OF[next];
  if (nextActivity !== rig.activity) {
    if (rig.activity === "dots") {
      const captured = REST_HOP.slice();
      for (let slot = 0; slot < 3; slot++)
        hopSlot(rig, slot, reduced, captured);
      rig.release = captured;
      rig.releaseAt = rig.clock;
    }
    if (rig.activity && rig.env.x > 0.02) {
      rig.prev = rig.activity;
      rig.fade.x = 0;
      rig.fade.v = 0;
      rig.fade.t = 1;
    } else {
      rig.prev = null;
      rig.fade.x = 1;
      rig.fade.v = 0;
      rig.fade.t = 1;
    }
    rig.activity = nextActivity;
    rig.activityStart = rig.clock;
    if (nextActivity === "dots") {
      rig.dotsStart = rig.clock;
      rig.releaseAt = -1;
    }
  }
  const pool = POSES[next];
  rig.poseIdx = 0;
  setPose(rig, pool[0], 200);
  scheduleFace(rig, rig.clock);
}

function weightOf(rig: RigState, name: RigActivity): number {
  "worklet";
  const e = clamp(rig.env.x, 0, 1);
  if (name === rig.activity) return e * clamp(rig.fade.x, 0, 1);
  if (name === rig.prev) return e * (1 - clamp(rig.fade.x, 0, 1));
  return 0;
}

export function createRig(state: WorkingIndicatorCharacterState): RigState {
  "worklet";
  const pool = POSES[state];
  const activity = ACTIVITY_OF[state];
  const zeros: number[] = [];
  for (let i = 0; i < N; i++) zeros.push(0);
  const rig: RigState = {
    state,
    activity,
    prev: null,
    activityStart: 0,
    dotsStart: 0,
    releaseAt: -1,
    release: REST_HOP.slice(),
    clock: 0,
    env: spring(0),
    fade: spring(1),
    blink: spring(1),
    bobX: spring(0),
    bobY: spring(0),
    breathe: spring(1),
    poseFrom: EYE_FLAT[pool[0]].slice(),
    poseCur: pool[0],
    poseMix: 1,
    poseDur: 160,
    poseAt: 0,
    poseIdx: 0,
    nextPoseAt: 0,
    nextBlinkAt: 0,
    blinkReleaseAt: -1,
    radii: zeros.slice(),
    lx: zeros.slice(),
    ly: zeros.slice(),
    span: [C, C],
    sparksShown: true,
    dotsIdle: false,
    out: {
      bodyD: "",
      matrix: [1, 0, 0, 1, 0, 0],
      eyeL: EMPTY_D,
      eyeR: EMPTY_D,
      sparkD: [EMPTY_D, EMPTY_D, EMPTY_D, EMPTY_D, EMPTY_D],
      sparkO: [0, 0, 0, 0, 0],
      dots: { w: 0, z: 1, bodyScale: 1, hop: REST_HOP.slice() },
      bodyDirty: true,
      matrixDirty: true,
      eyesDirty: true,
      sparksDirty: true,
      dotsDirty: true,
    },
  };
  scheduleFace(rig, 0);
  rig.env.t = 1;
  return rig;
}

function eyePath(
  pts: readonly number[],
  cx: number,
  cy: number,
  ew: number,
  eh: number,
): string {
  "worklet";
  let d = "";
  for (let k = 0; k < EYE_N; k++) {
    const x = Math.round((cx + pts[k * 2] * ew) * 100) / 100;
    const y = Math.round((cy + pts[k * 2 + 1] * eh) * 100) / 100;
    d += (k === 0 ? "M" : "L") + x + " " + y;
  }
  return d + "Z";
}

function round4(value: number): number {
  "worklet";
  return Math.round(value * 10000) / 10000;
}

export function stepRig(rig: RigState, dtMs: number, input: RigInput): void {
  "worklet";
  const { paused, reduced } = input;
  if (input.state !== rig.state) applyState(rig, input.state, reduced);
  const dt = paused ? 0 : Math.min(Math.max(dtMs, 0), 100) / 1000;
  rig.clock += dt * 1000;
  const t = rig.clock;
  const out = rig.out;

  if (rig.blinkReleaseAt >= 0 && t >= rig.blinkReleaseAt) {
    rig.blink.t = 1;
    rig.blinkReleaseAt = -1;
  }
  rig.env.t = rig.activity ? 1 : 0;
  if (reduced) {
    rig.env.x = rig.env.t;
    rig.fade.x = 1;
    rig.blink.x = 1;
    rig.bobX.x = 0;
    rig.bobY.x = 0;
    rig.breathe.x = 1;
  } else {
    const sub = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      stepSpring(rig.env, ENV_W, ENV_Z, h);
      stepSpring(rig.fade, FADE_W, FADE_Z, h);
      stepSpring(rig.blink, 26, 1, h);
      stepSpring(rig.bobX, 3.5, 1, h);
      stepSpring(rig.bobY, 4, 1, h);
      stepSpring(rig.breathe, 6, 0.9, h);
    }
  }
  if (rig.fade.x > 0.996) rig.prev = null;
  if (rig.poseMix < 1) {
    rig.poseMix = reduced ? 1 : clamp((t - rig.poseAt) / rig.poseDur, 0, 1);
  }

  if (!paused && !reduced) {
    if (t >= rig.nextPoseAt) {
      const pool = POSES[rig.state];
      rig.poseIdx =
        (rig.poseIdx + 1 + Math.floor(Math.random() * (pool.length - 1))) %
        pool.length;
      setPose(rig, pool[rig.poseIdx], rig.state === "searching" ? 110 : 170);
      const every = POSE_EVERY[rig.state];
      rig.nextPoseAt = t + randomIn(every[0], every[1]);
    }
    if (t >= rig.nextBlinkAt) {
      rig.blink.x = 1;
      rig.blink.t = 0.06;
      rig.blinkReleaseAt = t + 78;
      const every = BLINK_EVERY[rig.state];
      rig.nextBlinkAt = t + randomIn(every[0], every[1]);
    }
    rig.bobX.t = Math.sin(t * 0.00042) * 2.6 + Math.sin(t * 0.001) * 0.9;
    rig.bobY.t = Math.sin(t * 0.00058) * 2.0 + Math.sin(t * 0.0013) * 0.7;
    rig.breathe.t = 1 + 0.013 * Math.sin(t * 0.0016);
  }

  const act = clamp(rig.env.x, 0, 1);
  const wDots = weightOf(rig, "dots");
  const wTwinkle = weightOf(rig, "twinkle");
  const wOrbit = weightOf(rig, "orbit");

  const morph = clamp(wDots / MORPH_END, 0, 1);
  let bodyD = ORB_D;
  const lx = rig.lx;
  const ly = rig.ly;
  if (morph >= 1) {
    for (let i = 0; i < N; i++) {
      lx[i] = ORB_XS[i];
      ly[i] = ORB_YS[i];
    }
  } else {
    const shimmerAmp = paused || reduced ? 0 : 0.012 * (1 - wTwinkle);
    const shimmerPhase = t * 0.0009;
    const shimmerSin = shimmerAmp ? Math.sin(shimmerPhase) : 0;
    const shimmerCos = shimmerAmp ? Math.cos(shimmerPhase) : 0;
    const sweep = ((t - rig.activityStart) / 1900) * TAU;
    const twinkling = wTwinkle > 0.004;
    const radii = rig.radii;
    let max = 0;
    for (let i = 0; i < N; i++) {
      let r = STAR_PROFILE[i];
      if (shimmerAmp) {
        r *=
          1 +
          shimmerAmp *
            (RING_SHIMMER_SIN[i] * shimmerCos +
              RING_SHIMMER_COS[i] * shimmerSin);
      }
      if (twinkling) {
        const th = (i / N) * TAU;
        let d = Math.abs(((((th - sweep) % TAU) + TAU) % TAU) - Math.PI);
        d = Math.PI - d;
        const g = Math.exp(-(d * d) / (2 * 0.55 * 0.55));
        r *= 1 + 0.17 * wTwinkle * g;
      }
      radii[i] = r;
      if (r > max) max = r;
    }
    const k = C / (max || 1);
    const m = morph > 0 ? easeInOutCubic(morph) : 0;
    for (let i = 0; i < N; i++) {
      const r = radii[i] * k;
      const px = C + RING_COS[i] * r;
      const py = C + RING_SIN[i] * r;
      lx[i] = m > 0 ? px + (ORB_XS[i] - px) * m : px;
      ly[i] = m > 0 ? py + (ORB_YS[i] - py) * m : py;
    }
    bodyD = ringPath(lx, ly);
  }
  if (bodyD !== out.bodyD) {
    out.bodyD = bodyD;
    out.bodyDirty = true;
  }

  const fade = clamp(rig.fade.x, 0, 1);
  const activity = rig.activity;
  const bodyR = activity
    ? BODY_R[activity] * fade +
      (rig.prev ? BODY_R[rig.prev] : BODY_R[activity]) * (1 - fade)
    : C;
  const rest = 1 - act;
  const scale = rest * rig.breathe.x + (bodyR / C) * act;
  const tx = C + rig.bobX.x * rest;
  const ty = C + rig.bobY.x * rest;
  const rot = wOrbit > 0.004 ? Math.sin(t * 0.0009) * 3 * wOrbit : 0;
  const z = 1 + (DOTS_ZOOM - 1) * wDots * input.smallness;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = round4(z * scale * cos);
  const b = round4(z * scale * sin);
  const c = round4(-z * scale * sin);
  const dd = round4(z * scale * cos);
  const e = Math.round((C + z * (tx - C) - a * C - c * C) * 100) / 100;
  const f = Math.round((C + z * (ty - C) - b * C - dd * C) * 100) / 100;
  const mtx = out.matrix;
  if (
    mtx[0] !== a ||
    mtx[1] !== b ||
    mtx[2] !== c ||
    mtx[3] !== dd ||
    mtx[4] !== e ||
    mtx[5] !== f
  ) {
    out.matrix = [a, b, c, dd, e, f];
    out.matrixDirty = true;
  }

  let eyeL = EMPTY_D;
  let eyeR = EMPTY_D;
  if (!(wDots > 0.5)) {
    const pts = currentPose(rig);
    const tune = FACE_TUNE[rig.state];
    const socketX = C + FACE_DX;
    const socketY = C + FACE_DY - FACE_RY * 0.05;
    const half = FACE_RX * 0.42 * tune[1];
    const ew = FACE_RX * 0.78 * tune[0];
    const eh = FACE_RY * 0.62 * tune[0] * tune[2] * Math.max(rig.blink.x, 0.04);
    spanAt(lx, ly, socketY, C, rig.span);
    const left = rig.span[0];
    const right = rig.span[1];
    const cy = socketY + rig.bobY.x * 0.25;
    const cxL = clamp(socketX - half, left + ew * 0.8, right - ew * 0.8);
    const cxR = clamp(socketX + half, left + ew * 0.8, right - ew * 0.8);
    eyeL = eyePath(pts, cxL, cy, ew, eh);
    eyeR = eyePath(pts, cxR, cy, ew, eh);
  }
  if (eyeL !== out.eyeL || eyeR !== out.eyeR) {
    out.eyeL = eyeL;
    out.eyeR = eyeR;
    out.eyesDirty = true;
  }

  if (wOrbit > 0.004) {
    const a0 = t * 0.0016;
    const sparkD: string[] = [];
    const sparkO: number[] = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const angle = a0 + (i * TAU) / SPARK_COUNT;
      const ca = Math.cos(angle);
      const front = 0.5 + 0.5 * clamp(ca, 0, 1);
      const s = SPARK_SIZE * front * wOrbit;
      const spin = (((angle * 40) % 360) * Math.PI) / 180;
      const sc = Math.cos(spin);
      const ss = Math.sin(spin);
      const px = C + ORBIT_RX * Math.sin(angle);
      const py = C - ORBIT_RY * ca;
      let d = "";
      for (let j = 0; j < 8; j++) {
        const ux = SPARK_UX[j];
        const uy = SPARK_UY[j];
        const x = C + z * (px + s * (ux * sc - uy * ss) - C);
        const y = C + z * (py + s * (ux * ss + uy * sc) - C);
        d +=
          (j === 0 ? "M" : "L") +
          Math.round(x * 100) / 100 +
          " " +
          Math.round(y * 100) / 100;
      }
      sparkD.push(d + "Z");
      sparkO.push(
        Math.round(clamp((ca + 0.5) / 0.7, 0.2, 1) * wOrbit * 1000) / 1000,
      );
    }
    out.sparkD = sparkD;
    out.sparkO = sparkO;
    out.sparksDirty = true;
    rig.sparksShown = true;
  } else if (rig.sparksShown) {
    out.sparkD = [EMPTY_D, EMPTY_D, EMPTY_D, EMPTY_D, EMPTY_D];
    out.sparkO = [0, 0, 0, 0, 0];
    out.sparksDirty = true;
    rig.sparksShown = false;
  }

  const releasing = rig.releaseAt >= 0 && t - rig.releaseAt < BOUNCE_RELEASE_MS;
  const dotsIdle = wDots <= 0.004 && rig.activity !== "dots" && !releasing;
  if (!dotsIdle || !rig.dotsIdle) {
    const hop = REST_HOP.slice();
    for (let slot = 0; slot < 3; slot++) hopSlot(rig, slot, reduced, hop);
    out.dots = { w: wDots, z, bodyScale: scale * z, hop };
    out.dotsDirty = true;
  }
  rig.dotsIdle = dotsIdle;
}
