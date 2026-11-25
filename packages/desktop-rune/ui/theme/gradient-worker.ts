import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodePng } from "@stella/theme/gradient-image";
import { planGradientFrame, renderGradientPixels, type GradientFrameInput } from "@stella/theme/gradient";

declare const self: Worker;

export type GradientRequest = { id: number; input: GradientFrameInput; width: number; height: number; scale: number };
export type GradientReply = { id: number; path: string; width: number; height: number };

const DIR = join(tmpdir(), `stella-rune-${process.getuid?.() ?? 0}`, "gradient");
mkdirSync(DIR, { recursive: true });

self.onmessage = async (e: MessageEvent<GradientRequest>) => {
  const { id, input, width, height, scale } = e.data;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const pixels = new Uint8ClampedArray(w * h * 4);
  const { bg, blobs } = planGradientFrame(input);
  renderGradientPixels(pixels, w, h, bg, blobs);
  const png = encodePng(pixels, w, h);
  const path = join(DIR, `${Bun.hash(png).toString(36)}.png`);
  if (!(await Bun.file(path).exists())) await Bun.write(path, png);
  self.postMessage({ id, path, width: w, height: h } satisfies GradientReply);
};
