import React, { useLayoutEffect, useMemo, useRef } from "react";
import { CHAT, type SkinProps } from "./content";
import { F, hash } from "./kit";

/**
 * "Turn yourself into a platformer."
 * A single-screen level drawn into a real low-resolution framebuffer (1 px = 4 screen px):
 * a dithered dusk sky, a setting sun, parallax ranges and hills, grass-capped earth.
 * Each message is a floating platform (Stella's are grassy earth, yours are blue stone),
 * stacked like a climb; the HUD is the top bar; the composer is a tablet set into the ground;
 * Stella, as a pixel hero, runs the lane at the bottom collecting task coins.
 */

const P = 4; // screen px per art pixel

// ---- palette (one cohesive dusk ramp)
const HEX = {
  ink: "#1a1630",
  hud: "#14122a",
  hudHi: "#2b2752",
  sky0: "#232a5c",
  sky1: "#33387a",
  sky2: "#4d4492",
  sky3: "#7a52a0",
  sky4: "#b4609f",
  sky5: "#e57d93",
  sky6: "#ffa889",
  sky7: "#ffc996",
  sun: "#fff0b8",
  sunRim: "#ffd57e",
  cloud: "#ffd8cc",
  cloudSh: "#eda3b0",
  cloudDeep: "#c27aa4",
  mtn: "#4b3b88",
  mtnLit: "#7056a8",
  mtnFar: "#6a4f9c",
  snow: "#f2d6ee",
  hill: "#2d5878",
  hillLit: "#3f7c8c",
  hillNear: "#24486a",
  tree: "#1d3d5c",
  treeLit: "#2f6676",
  grassHi: "#b6f06a",
  grass: "#7fd257",
  grassMid: "#52ab47",
  grassDk: "#357a3f",
  dirt: "#7c3e3d",
  dirtDk: "#562a3c",
  dirtDeep: "#3c1d33",
  dirtLt: "#9c5747",
  pebble: "#b97a5c",
  stone: "#4a62c6",
  stoneLt: "#86a2f2",
  stoneDk: "#2f3f96",
  stoneFace: "#3a4fae",
  coin: "#ffd147",
  coinLt: "#fff4b0",
  coinDk: "#d58a2a",
  hero: "#5a8cff",
  heroLt: "#b4d6ff",
  heroDk: "#3a46c8",
  heroRim: "#ff8fd0",
  white: "#ffffff",
  panel: "#2a1a33",
  panelHi: "#5b3a5e",
  snail: "#f2a65a",
  snailDk: "#b8643a",
  shell: "#c45a7a",
  shellLt: "#ee86a0",
  red: "#ff5a5a",
  amber: "#ffc13b",
  green: "#4fd06a",
  flower: "#ffe066",
  flower2: "#ff7aa8",
} as const;
type Col = keyof typeof HEX;
const C32 = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => {
    const n = parseInt(v.slice(1), 16);
    const r = (n >> 16) & 255,
      g = (n >> 8) & 255,
      b = n & 255;
    return [k, ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0];
  }),
) as Record<Col, number>;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

class Buf {
  d: Uint32Array;
  constructor(
    public W: number,
    public H: number,
  ) {
    this.d = new Uint32Array(W * H);
  }
  px(x: number, y: number, c: Col) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    this.d[y * this.W + x] = C32[c];
  }
  rect(x: number, y: number, w: number, h: number, c: Col) {
    const x0 = Math.max(0, x | 0),
      y0 = Math.max(0, y | 0),
      x1 = Math.min(this.W, (x + w) | 0),
      y1 = Math.min(this.H, (y + h) | 0);
    const v = C32[c];
    for (let j = y0; j < y1; j++) this.d.fill(v, j * this.W + x0, j * this.W + x1);
  }
  disc(cx: number, cy: number, r: number, c: Col, yMax = 1e9) {
    for (let y = Math.floor(cy - r); y <= cy + r && y <= yMax; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.px(x, y, c);
  }
  sprite(rows: string[], x: number, y: number, map: Record<string, Col>, flip = false) {
    for (let j = 0; j < rows.length; j++)
      for (let i = 0; i < rows[j].length; i++) {
        const ch = rows[j][flip ? rows[j].length - 1 - i : i];
        if (ch !== "." && ch !== " " && map[ch]) this.px(x + i, y + j, map[ch]);
      }
  }
}

const HERO_ROWS = [
  "........xxxxx........",
  ".......xxxxxxx.......",
  ".......xxxxxxx.......",
  "......xxxxxxxxx......",
  "xxx...xxxxxxxxx...xxx",
  "xxxxxxxxxxxxxxxxxxxxx",
  "xxxxxxxxxxxxxxxxxxxxx",
  ".xxxxxxxxxxxxxxxxxxx.",
  "..xxxxxxxxxxxxxxxxx..",
  "...xxxxxxxxxxxxxxx...",
  "....xxxxxxxxxxxxx....",
  "...xxxxxxxxxxxxxxx...",
  "..xxxxxxxxxxxxxxxxx..",
  ".xxxxxxxxxxxxxxxxxxx.",
  "xxxxxxxxxxxxxxxxxxxxx",
  "xxxxxxxxxxxxxxxxxxxxx",
  "xxx...xxxxxxxxx...xxx",
  "......xxxxxxxxx......",
  ".......xxxxxxx.......",
  ".......xxxxxxx.......",
  "........xxxxx........",
];
const toMask = (rows: string[]) => rows.map((r) => r.split("").map((c) => c === "x"));
const HERO_N = 21;
const HERO_FRAMES = {
  idle: toMask(HERO_ROWS),
  // squash: lose three rows on landing
  squash: toMask(HERO_ROWS.filter((_, i) => i !== 2 && i !== 18 && i !== 10)),
  stretch: toMask([...HERO_ROWS.slice(0, 3), HERO_ROWS[2], ...HERO_ROWS.slice(3, 10), HERO_ROWS[10], ...HERO_ROWS.slice(10, 18), HERO_ROWS[18], ...HERO_ROWS.slice(18)]),
};

function drawHero(b: Buf, mask: boolean[][], x0: number, y0: number, blink: boolean, look: number) {
  const n = mask.length;
  const nw = mask[0].length;
  y0 += HERO_N - n; // keep the feet on the ground whatever the frame
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < nw && y < n && mask[y][x];
  // outline first (1px around)
  for (let y = -1; y <= n; y++)
    for (let x = -1; x <= nw; x++) {
      if (at(x, y)) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) b.px(x0 + x, y0 + y, "ink");
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < nw; x++) {
      if (!at(x, y)) continue;
      let c: Col = "hero";
      if (!at(x - 1, y - 1) || !at(x, y - 1)) c = "heroLt";
      if (!at(x + 2, y + 2) || !at(x + 1, y + 2)) c = "heroDk";
      if (!at(x, y + 1) && x > 3 && x < nw - 3) c = "heroRim";
      b.px(x0 + x, y0 + y, c);
    }
  // shine
  b.px(x0 + 8, y0 + 3, "white");
  b.px(x0 + 9, y0 + 2, "white");
  b.px(x0 + 3, y0 + 6, "white");
  // eyes (white pills, 2x4) looking toward travel
  const ey = y0 + Math.round(n * 0.4);
  for (const ex of [x0 + 7 + look, x0 + 12 + look]) {
    if (blink) b.rect(ex, ey + 2, 2, 1, "ink");
    else {
      b.rect(ex, ey, 2, 4, "white");
      b.px(ex + (look > 0 ? 1 : 0), ey + 3, "ink");
    }
  }
}

// ---- coin (4-frame spin)
const COIN = [
  ["..kkkk..", ".kyyyyk.", "kyYYyyyk", "kyYyyydk", "kyYyyydk", "kyYyyydk", "kyYyyydk", "kyyyyydk", ".kyyddk.", "..kkkk.."],
  ["..kkk...", ".kyYyk..", ".kYyyk..", ".kYydk..", ".kYydk..", ".kYydk..", ".kYydk..", ".kyydk..", ".kyddk..", "..kkk..."],
  ["...kk...", "...kYk..", "...kYk..", "...kYk..", "...kYk..", "...kYk..", "...kYk..", "...kYk..", "...kdk..", "...kk..."],
  ["...kkk..", "..kyYyk.", "..kYyyk.", "..kYydk.", "..kYydk.", "..kYydk.", "..kYydk.", "..kyydk.", "..kyddk.", "...kkk.."],
];
const COIN_MAP: Record<string, Col> = { k: "ink", y: "coin", Y: "coinLt", d: "coinDk" };

// ---- snail (original critter)
const SNAIL = [
  "....kkkk....",
  "...kSSSsk...",
  "..kSssSSsk..",
  "..kSsKKsSk..",
  "..kSsSKsSk..",
  "..kSSssSsk.k",
  ".kkkSSSSkkkb",
  "kbbbkkkkbbbk",
  "kbbbbbbbbbk.",
  ".kkkkkkkkk..",
];
const SNAIL_MAP: Record<string, Col> = { k: "ink", S: "shell", s: "shellLt", K: "dirtDeep", b: "snail" };

// ---- pixel icons for the HUD
const GEAR = ["..k.k..", ".kkkkk.", "kkk.kkk", ".k...k.", "kkk.kkk", ".kkkkk.", "..k.k.."];
const PANEL = ["kkkkkkk", "k...k.k", "k...k.k", "k...k.k", "k...k.k", "kkkkkkk"];

type Plat = { text: string; me: boolean; x: number; y: number; w: number; h: number; lines: number };

function layout(W: number, H: number, tall: boolean) {
  const hud = 15;
  const ground = H - (tall ? 32 : 30);
  const plats: Plat[] = [];
  if (!tall) {
    plats.push({ text: CHAT.me1, me: true, x: 172, y: 34, w: 146, h: 22, lines: 2 });
    plats.push({ text: CHAT.her1, me: false, x: 52, y: 66, w: 140, h: 22, lines: 2 });
    plats.push({ text: CHAT.me2, me: true, x: 184, y: 100, w: 134, h: 16, lines: 1 });
    plats.push({ text: CHAT.her2, me: false, x: 52, y: 128, w: 118, h: 16, lines: 1 });
  } else {
    plats.push({ text: CHAT.me1, me: true, x: 36, y: 36, w: 166, h: 26, lines: 2 });
    plats.push({ text: CHAT.her1, me: false, x: 8, y: 76, w: 160, h: 26, lines: 2 });
    plats.push({ text: CHAT.me2, me: true, x: 66, y: 116, w: 136, h: 26, lines: 2 });
    plats.push({ text: CHAT.her2, me: false, x: 8, y: 156, w: 128, h: 26, lines: 2 });
  }
  return { hud, ground, plats };
}

/** Where the hero is at time t: running right along the lane, hopping a snail and a coin arc. */
function heroAt(t: number, W: number, ground: number) {
  const speed = 46; // art px per second
  const span = W + 40;
  const x = ((((t + 1.6) * speed) % span) + span) % span - 20;
  // a jump every 2.2s (so one lands inside any 2.5s window)
  const ph = (t + 0.75) % 2.2;
  const jumpDur = 0.62;
  let lift = 0;
  let frame: keyof typeof HERO_FRAMES = "idle";
  if (ph < jumpDur) {
    const u = ph / jumpDur;
    lift = 4 * 25 * u * (1 - u);
    frame = "idle";
  } else {
    // running: little hops on every stride
    const s = ((t * 5.2) % 1 + 1) % 1;
    lift = Math.abs(Math.sin(s * Math.PI)) * 2.2;
    frame = s < 0.18 ? "squash" : "idle";
  }
  return { x, y: ground - HERO_N - Math.round(lift), frame, airborne: ph < jumpDur, ph };
}

function paint(b: Buf, t: number, tall: boolean) {
  const W = b.W,
    H = b.H;
  const { hud, ground, plats } = layout(W, H, tall);

  // ---- sky: flat bands, dithered only at each seam
  const sky: Col[] = ["sky0", "sky1", "sky2", "sky3", "sky4", "sky5", "sky6", "sky7"];
  const skyTop = hud,
    skyBot = ground - (tall ? 40 : 34);
  for (let y = skyTop; y < ground; y++) {
    const v = Math.max(0, ((y - skyTop) / (skyBot - skyTop)) * (sky.length - 1));
    const i = Math.min(sky.length - 1, Math.floor(v));
    const f = v - i;
    for (let x = 0; x < W; x++) {
      const next = f > 0.45 && (f - 0.45) / 0.55 > bayer(x, y) && i + 1 < sky.length;
      b.px(x, y, next ? sky[i + 1] : sky[i]);
    }
  }
  // a few early stars in the dark top
  for (let i = 0; i < (tall ? 18 : 26); i++) {
    const x = Math.floor(hash(i, 70) * W);
    const y = skyTop + 2 + Math.floor(hash(i, 71) * (tall ? 34 : 26));
    const tw = Math.sin(t * (2 + hash(i, 72) * 3) + i) > -0.3;
    if (tw) b.px(x, y, hash(i, 73) > 0.6 ? "sunRim" : "snow");
  }

  // ---- sun
  const sunX = tall ? 158 : 300,
    sunY = ground - (tall ? 66 : 54),
    sunR = tall ? 22 : 20;
  b.disc(sunX, sunY, sunR + 2, "sunRim");
  b.disc(sunX, sunY, sunR, "sun");

  // ---- clouds (drift)
  const clouds = tall
    ? [
        [30, 214, 26, 0.0],
        [150, 200, 18, 0.0],
        [90, 236, 14, 0.0],
      ]
    : [
        [40, 40, 24, 0],
        [330, 74, 20, 0],
        [190, 150, 30, 0],
        [12, 160, 16, 0],
      ];
  clouds.forEach(([cx, cy, cw], k) => {
    const dx = ((cx + t * (5 + 2 * k)) % (W + 60)) - 30;
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const u = i / 4;
      pts.push([dx + (u - 0.5) * cw * 1.6, cy - Math.sin(u * Math.PI) * cw * 0.25, cw * (0.22 + 0.2 * Math.sin(u * Math.PI))]);
    }
    for (const [x, y, r] of pts) b.disc(x, y + 1, r, "cloudDeep", cy + 3);
    for (const [x, y, r] of pts) b.disc(x, y, r, "cloudSh", cy + 2);
    for (const [x, y, r] of pts) b.disc(x - 1, y - 1.5, r * 0.82, "cloud", cy);
  });

  // ---- far range (slight parallax drift), lit on the sun side, snowcaps
  const cam = t * 6;
  const range = (x: number) => {
    const X = x + cam * 0.3;
    return (
      Math.abs(Math.sin(X * 0.031)) * 26 +
      Math.abs(Math.sin(X * 0.071 + 1.3)) * 12 +
      Math.sin(X * 0.013 + 0.5) * 8
    );
  };
  const rBase = ground - (tall ? 24 : 18);
  for (let x = 0; x < W; x++) {
    const top = Math.round(rBase - 16 - range(x));
    const slope = range(x + 1) - range(x - 1);
    for (let y = top; y < rBase + 4; y++) {
      let c: Col = slope < 0 ? "mtnLit" : "mtn";
      if (y - top < 4 && rBase - top > 40) c = slope < 0 ? "snow" : "mtnFar";
      b.px(x, y, c);
    }
  }
  // ---- mid hills with trees (more parallax)
  const hillY = (x: number) => {
    const X = x + cam * 0.8;
    return ground - 10 - (Math.sin(X * 0.045) * 6 + Math.sin(X * 0.017 + 2) * 8 + 10);
  };
  for (let x = 0; x < W; x++) {
    const top = Math.round(hillY(x));
    for (let y = top; y < ground; y++) {
      const edge = y - top;
      const c: Col = edge < 2 ? "hillLit" : edge < 3 && bayer(x, y) > 0.5 ? "hillLit" : "hill";
      b.px(x, y, c);
    }
  }
  for (let i = 0; i < (tall ? 12 : 22); i++) {
    const X = ((hash(i, 80) * (W + 40) - cam * 0.8) % (W + 40) + W + 40) % (W + 40) - 20;
    const top = Math.round(hillY(X));
    const th = 7 + Math.floor(hash(i, 81) * 7);
    // pine: stacked widening rows
    for (let j = 0; j < th; j++) {
      const half = Math.floor((j / th) * 3.4) + (j % 3 === 2 ? 0 : 0);
      for (let k = -half; k <= half; k++) b.px(X + k, top - th + j + 2, k < 0 ? "treeLit" : "tree");
    }
    b.px(X, top + 2, "tree");
  }
  // nearer hill band
  for (let x = 0; x < W; x++) {
    const X = x + cam * 1.6;
    const top = Math.round(ground - 4 - (Math.sin(X * 0.06 + 1) * 3 + 3));
    for (let y = top; y < ground; y++) b.px(x, y, "hillNear");
  }

  // ---- ground: grass cap with tufts, earth with pebbles
  for (let x = 0; x < W; x++) {
    b.px(x, ground, "grassHi");
    b.rect(x, ground + 1, 1, 2, "grass");
    b.px(x, ground + 3, (x + Math.floor(x / 5)) % 3 === 0 ? "grassDk" : "grassMid");
    if (hash(x, 90) > 0.82) b.px(x, ground + 4, "grassMid");
    if (hash(x, 91) > 0.8) b.px(x, ground - 1, "grass");
  }
  b.rect(0, ground + 4, W, H - ground - 4, "dirt");
  for (let y = ground + 4; y < H; y++)
    for (let x = 0; x < W; x++) {
      const deep = (y - ground - 4) / (H - ground - 4);
      if (deep > 0.55 && bayer(x, y) < (deep - 0.55) * 1.6) b.px(x, y, "dirtDk");
    }
  for (let i = 0; i < W * 0.5; i++) {
    const x = Math.floor(hash(i, 92) * W),
      y = ground + 6 + Math.floor(hash(i, 93) * (H - ground - 8));
    b.px(x, y, "pebble");
    b.px(x + 1, y, "dirtLt");
    b.px(x, y + 1, "dirtDk");
  }

  // ---- platforms
  plats.forEach((p, k) => {
    const { x, y, w, h } = p;
    if (p.me) {
      // blue stone slab: bevelled blocks at the ends, a flat face for the words
      b.rect(x - 1, y - 1, w + 2, h + 2, "ink");
      b.rect(x, y, w, h, "stoneFace");
      b.rect(x, y, w, 2, "stoneLt");
      b.rect(x, y + h - 2, w, 2, "stoneDk");
      for (const bx of [x, x + w - 8]) {
        b.rect(bx, y, 8, h, "stone");
        b.rect(bx, y, 8, 1, "stoneLt");
        b.rect(bx, y, 1, h, "stoneLt");
        b.rect(bx + 7, y, 1, h, "stoneDk");
        b.rect(bx, y + Math.floor(h / 2), 8, 1, "stoneDk");
        b.rect(bx, y + h - 1, 8, 1, "stoneDk");
      }
      b.rect(x + 8, y + 2, 1, h - 4, "stoneDk");
      b.rect(x + w - 9, y + 2, 1, h - 4, "stoneLt");
    } else {
      // earth with a grass cap, dangling roots
      b.rect(x - 1, y - 1, w + 2, h + 2, "ink");
      b.rect(x, y, w, h, "dirt");
      b.rect(x + 3, y + 5, w - 6, h - 8, "dirtDeep");
      b.rect(x + 3, y + 5, w - 6, 1, "dirtDk");
      for (let i = 0; i < w; i++) {
        b.px(x + i, y, "grassHi");
        b.px(x + i, y + 1, "grass");
        b.px(x + i, y + 2, "grass");
        b.px(x + i, y + 3, i % 3 === 0 ? "grassDk" : "grassMid");
        if (hash(i, 100 + k) > 0.7) b.px(x + i, y + 4, "grassDk");
        if (hash(i, 110 + k) > 0.84) b.px(x + i, y - 1, "grass");
      }
      for (const yy of [y + 6, y + h - 4]) for (const xx of [x + 1, x + w - 2]) b.px(xx, yy, "pebble");
      // roots / vines swaying one pixel
      for (let r = 0; r < 4; r++) {
        const rx = x + 10 + Math.floor(hash(r, 120 + k) * (w - 20));
        const len = 3 + Math.floor(hash(r, 130 + k) * 5);
        for (let j = 0; j < len; j++) {
          const sway = j > 1 && Math.sin(t * 2.4 + r + k) > 0.3 ? 1 : 0;
          b.px(rx + (j > len - 3 ? sway : 0), y + h + 1 + j, j === len - 1 ? "grass" : "grassDk");
        }
      }
      // a flower
      const fx = x + w - 14 - k * 3;
      b.px(fx, y - 2, "grassDk");
      b.px(fx, y - 3, k % 2 ? "flower" : "flower2");
      b.px(fx - 1, y - 3, "white");
      b.px(fx + 1, y - 3, "white");
      b.px(fx, y - 4, "white");
    }
  });

  // ---- coins: floating over the lane and on the steps (spinning)
  const coinFrame = (i: number) => COIN[[0, 0, 1, 2, 3, 0][Math.floor(t * 9 + i * 0.7) % 6]];
  const coinsAt: [number, number][] = [
    [128, ground - 40],
    [140, ground - 46],
    [152, ground - 40],
    ...plats.filter((p) => !p.me).flatMap((p, k) => [0, 1, 2].map((j): [number, number] => [p.x + p.w - 40 + j * 11 - k * 8, p.y - 11])),
    ...(tall ? [] : ([[300, ground - 30], [312, ground - 30]] as [number, number][])),
  ];
  const hero = heroAt(t, W, ground);
  // a coin the hero has passed through is taken (checked along the path so far) and leaves a brief twinkle
  const takenAt = (cx: number, cy: number) => {
    for (let tt = Math.max(0, t - 3); tt <= t; tt += 1 / 60) {
      const hh = heroAt(tt, W, ground);
      if (Math.abs(hh.x + HERO_N / 2 - cx - 4) < 9 && Math.abs(hh.y + HERO_N / 2 - cy - 5) < 12) return tt;
    }
    return -1;
  };
  coinsAt.forEach(([cx, cy], i) => {
    const got = takenAt(cx, cy);
    if (got >= 0) {
      const age = t - got;
      if (age < 0.45) {
        const r = 2 + Math.round(age * 14);
        const c: Col = age < 0.2 ? "coinLt" : "coin";
        b.px(cx + 4, cy + 5 - r, c);
        b.px(cx + 4, cy + 5 + r, c);
        b.px(cx + 4 - r, cy + 5, c);
        b.px(cx + 4 + r, cy + 5, c);
        b.px(cx + 4, cy + 5, "white");
      }
      return;
    }
    b.sprite(coinFrame(i), cx, cy + Math.round(Math.sin(t * 3 + i) * 1), COIN_MAP);
  });

  // ---- the snail, plodding left on the ground
  const sx = (((150 - t * 6) % (W + 20)) + W + 20) % (W + 20) - 10;
  b.sprite(SNAIL, Math.round(sx), ground - SNAIL.length + 1, SNAIL_MAP);

  // ---- hero
  const blink = (t + 0.3) % 2.8 > 2.65;
  const hx = Math.round(hero.x),
    hy = hero.y;
  // dust puffs behind the feet while running
  if (!hero.airborne) {
    for (let i = 0; i < 3; i++) {
      const age = ((t * 5.2 + i / 3) % 1 + 1) % 1;
      const dx = hx - 2 - Math.round(age * 7);
      const dy = ground - 2 - Math.round(age * 3);
      if (age < 0.8) b.px(dx, dy, age < 0.4 ? "cloud" : "cloudSh");
    }
  } else {
    // sparkle trail in the air
    for (let i = 1; i < 5; i++) {
      const u = (hero.ph - i * 0.05) / 0.62;
      if (u < 0 || u > 1) continue;
      const trail = heroAt(t - i * 0.05, W, ground);
      b.px(Math.round(trail.x + 9), trail.y + HERO_N - 2, i % 2 ? "coinLt" : "heroRim");
    }
  }
  drawHero(b, HERO_FRAMES[hero.frame], hx, hy, blink, 1);
  // "+1" popping from the last coin taken
  return { hud, ground, plats, hero };
}

const PixelCanvas: React.FC<{ t: number; W: number; H: number; tall: boolean }> = ({ t, W, H, tall }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const buf = useMemo(() => new Buf(W, H), [W, H]);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    buf.d.fill(0);
    paint(buf, t, tall);
    const img = ctx.createImageData(W, H);
    img.data.set(new Uint8ClampedArray(buf.d.buffer, buf.d.byteOffset, buf.d.byteLength));
    ctx.putImageData(img, 0, 0);
  }, [t, W, H, tall, buf]);
  return <canvas ref={ref} width={W} height={H} style={{ position: "absolute", left: 0, top: 0, width: W * P, height: H * P, imageRendering: "pixelated" }} />;
};

/** Tiny pixel sprite as an SVG (for HUD icons that sit over DOM). */
const PixSvg: React.FC<{ rows: string[]; map: Record<string, string>; s: number; style?: React.CSSProperties }> = ({ rows, map, s, style }) => (
  <svg width={rows[0].length * s} height={rows.length * s} shapeRendering="crispEdges" style={style}>
    {rows.flatMap((r, y) =>
      r.split("").map((ch, x) => (map[ch] ? <rect key={`${x}-${y}`} x={x * s} y={y * s} width={s} height={s} fill={map[ch]} /> : null)),
    )}
  </svg>
);

const HERO_ICON = ["....hhh....", "....hhh....", "hh.hhhhh.hh", "hhhhhhhhhhh", ".hhhwhwhhh.", "..hhwhwhh..", ".hhhhhhhhh.", "hhhhhhhhhhh", "hh.hhhhh.hh", "....hhh....", "....hhh...."];

export const PlatformerSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const W = Math.ceil(w / P);
  const H = Math.ceil(h / P);
  const { hud, ground, plats } = layout(W, H, tall);
  const fs = tall ? 28 : 23;
  const caret = Math.floor(t * 2.5) % 2 === 0;
  const taken = 0;
  void taken;
  const hudFs = 16;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: HEX.sky0 }}>
      <PixelCanvas t={t} W={W} H={H} tall={tall} />

      {/* HUD = the top bar */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: hud * P, background: HEX.hud, borderBottom: `${P}px solid ${HEX.ink}`, boxShadow: `inset 0 -${P}px 0 ${HEX.hudHi}` }}>
        <div style={{ position: "absolute", left: 22, top: 0, height: hud * P - P, display: "flex", alignItems: "center", gap: 10 }}>
          {[HEX.red, HEX.amber, HEX.green].map((c, i) => (
            <PixSvg key={i} s={3} rows={[".kkkk.", "kcwcck", "kwccck", "kcccck", "kcccck", ".kkkk."]} map={{ k: "#000", c, w: "#fff" }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: tall ? 120 : 132, top: 0, height: hud * P - P, display: "flex", alignItems: "center", gap: 10, fontFamily: F.press, fontSize: hudFs, color: "#fff" }}>
          <PixSvg s={3} rows={COIN[0]} map={{ k: HEX.ink, y: HEX.coin, Y: HEX.coinLt, d: HEX.coinDk }} />
          <span>×02</span>
          {tall ? null : <span style={{ color: HEX.sky5, marginLeft: 20 }}>TASKS DONE</span>}
        </div>
        <div style={{ position: "absolute", left: 0, width: w, top: 0, height: hud * P - P, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: F.press, fontSize: hudFs, color: "#fff", pointerEvents: "none" }}>
          <PixSvg s={3} rows={HERO_ICON} map={{ h: HEX.hero, w: "#fff" }} />
          <span style={{ letterSpacing: 1 }}>STELLA</span>
        </div>
        <div style={{ position: "absolute", right: 22, top: 0, height: hud * P - P, display: "flex", alignItems: "center", gap: 16, fontFamily: F.press, fontSize: hudFs, color: "#fff" }}>
          <span>ACCOUNT</span>
          {tall ? null : <span style={{ color: HEX.coin, fontSize: 12 }}>PRO</span>}
          <PixSvg s={3} rows={GEAR} map={{ k: "#fff" }} />
          <PixSvg s={3} rows={PANEL} map={{ k: "#fff" }} />
        </div>
      </div>

      {/* stamp as the level banner */}
      <div
        style={{
          position: "absolute",
          left: 0,
          width: w,
          top: (tall ? 20 : 19) * P,
          display: "flex",
          justifyContent: "center",
          fontFamily: F.press,
          fontSize: 16,
          color: "#fff",
          letterSpacing: 1,
          textShadow: `${P / 2}px ${P / 2}px 0 ${HEX.ink}`,
        }}
      >
        {CHAT.stamp.toUpperCase()}
      </div>

      {/* words on the platforms */}
      {plats.map((p, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: (p.x + (p.me ? 11 : 5)) * P,
            top: (p.y + (p.me ? 2 : 5)) * P,
            width: (p.w - (p.me ? 22 : 10)) * P,
            height: (p.h - (p.me ? 4 : 8)) * P,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontFamily: F.pixel,
            fontWeight: 500,
            fontSize: fs,
            lineHeight: 1.12,
            color: p.me ? "#ffffff" : "#ffe9c6",
            textShadow: `0 ${P / 2}px 0 ${p.me ? HEX.stoneDk : HEX.ink}`,
          }}
        >
          {p.text}
        </div>
      ))}

      {/* composer: a tablet set into the ground */}
      {(() => {
        const cx = (tall ? 6 : 20) * P;
        const cy = (ground + 7) * P;
        const cw = w - cx * 2;
        const ch = (tall ? 19 : 17) * P;
        return (
          <div style={{ position: "absolute", left: cx, top: cy, width: cw, height: ch, background: HEX.panel, boxShadow: `0 0 0 ${P}px ${HEX.ink}, inset ${P}px ${P}px 0 ${HEX.dirtDeep}, inset -${P}px -${P}px 0 ${HEX.panelHi}` }}>
            <div style={{ position: "absolute", left: P * 3, top: (ch - 10 * P) / 2 }}>
              <PixSvg s={P} rows={["kkkkkkkkkk", "kbbbbbbbbk", "kbbbwwbbbk", "kbbbwwbbbk", "kbwwwwwwbk", "kbwwwwwwbk", "kbbbwwbbbk", "kbbbwwbbbk", "kddddddddk", "kkkkkkkkkk"]} map={{ k: HEX.ink, b: HEX.stone, w: "#fff", d: HEX.stoneDk }} />
            </div>
            <div style={{ position: "absolute", left: P * 17, top: 0, height: ch, display: "flex", alignItems: "center", fontFamily: F.pixel, fontSize: fs + 2, color: "#b99ab8" }}>
              <span style={{ color: HEX.coin, marginRight: 12 }}>▶</span>
              {CHAT.placeholder}
              <span style={{ display: "inline-block", width: 3 * P, height: 6 * P, marginLeft: 8, background: caret ? HEX.coinLt : "transparent" }} />
            </div>
            <div style={{ position: "absolute", right: P * 15, top: (ch - 9 * P) / 2 }}>
              <PixSvg s={P} rows={["..kkkk..", "..kkkk..", "..kkkk..", "..kkkk..", "k.kkkk.k", "k..kk..k", ".k....k.", "..kkkk..", "...kk...", "..kkkk.."]} map={{ k: "#d9c3d6", w: "#d9c3d6" }} />
            </div>
            <div style={{ position: "absolute", right: P * 3, top: (ch - 10 * P) / 2 }}>
              <PixSvg s={P} rows={["kkkkkkkkkk", "kyyyyyyyyk", "kyyyKKyyyk", "kyyKKKKyyk", "kyKKKKKKyk", "kyyyKKyyyk", "kyyyKKyyyk", "kyyyKKyyyk", "kddddddddk", "kkkkkkkkkk"]} map={{ k: HEX.ink, y: HEX.coin, K: HEX.ink, d: HEX.coinDk }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
};
