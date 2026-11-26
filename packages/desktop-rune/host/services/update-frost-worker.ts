// Makes the frosted still a relaunch holds on, as Electron's transition page draws it on a canvas:
// the frame at half size under `blur(26px) saturate(1.6)` and the tint, as JPEG. Posts whether the
// frame reads dark as soon as it knows, then the still.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

type Photon = typeof import("@silvia-odwyer/photon-node");

declare const self: Worker;

const FROST_BLUR = 26;
const FROST_SATURATE = 1.6;
/** CSS `saturate()` (Filter Effects, feColorMatrix type="saturate"). */
const SATURATE = ((v: number) => [
  0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v,
  0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v,
  0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v,
])(FROST_SATURATE);
const TINT_LIGHT: [number, number, number, number] = [255, 255, 255, 0.46];
const TINT_DARK: [number, number, number, number] = [28, 28, 30, 0.4];

const photon = (): Photon =>
  createRequire(path.join(import.meta.dir, "../../../desktop/package.json"))("@silvia-odwyer/photon-node") as Photon;

self.onmessage = (e: MessageEvent<{ file: string; scale: number }>) => {
  try {
    const p = photon();
    const full = p.PhotonImage.new_from_byteslice(readFileSync(e.data.file));
    const thumb = p.resize(full, 16, 10, p.SamplingFilter.Triangle);
    const px = thumb.get_raw_pixels();
    thumb.free();
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
    const dark = sum / (px.length / 4) / 255 < 0.5;
    self.postMessage({ dark });

    const w = full.get_width();
    const h = full.get_height();
    const quarter = p.resize(full, Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)), p.SamplingFilter.Triangle);
    full.free();
    p.gaussian_blur(quarter, Math.max(1, Math.round((FROST_BLUR * e.data.scale) / 4)));
    const half = p.resize(quarter, Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)), p.SamplingFilter.Triangle);
    quarter.free();
    const raw = half.get_raw_pixels();
    const [tr, tg, tb, ta] = dark ? TINT_DARK : TINT_LIGHT;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = SATURATE as [number, number, number, number, number, number, number, number, number];
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let i = 0; i < raw.length; i += 4) {
      const r = raw[i]!;
      const g = raw[i + 1]!;
      const b = raw[i + 2]!;
      raw[i] = clamp(m0 * r + m1 * g + m2 * b) * (1 - ta) + tr * ta;
      raw[i + 1] = clamp(m3 * r + m4 * g + m5 * b) * (1 - ta) + tg * ta;
      raw[i + 2] = clamp(m6 * r + m7 * g + m8 * b) * (1 - ta) + tb * ta;
    }
    const tinted = new p.PhotonImage(raw, half.get_width(), half.get_height());
    half.free();
    const jpeg = tinted.get_bytes_jpeg(90);
    tinted.free();
    self.postMessage({ jpeg, dark });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
