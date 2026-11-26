import { encodePng } from "@stella/theme/gradient-image";
import { planGradientFrame, renderGradientPixels, type GradientFrameInput } from "@stella/theme/gradient";

export type GradientRequest = { id: number; input: GradientFrameInput; width: number; height: number; scale: number };
export type GradientReply = { id: number; path: string; width: number; height: number };

const urls = new Map<string, string>();

/** The backdrop as an object URL of its PNG (the desktop writes a file the engine reads). */
export async function renderGradientFile({ id, input, width, height, scale }: GradientRequest): Promise<GradientReply> {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const pixels = new Uint8ClampedArray(w * h * 4);
  const { bg, blobs } = planGradientFrame(input);
  renderGradientPixels(pixels, w, h, bg, blobs);
  const png = encodePng(pixels, w, h);
  const key = String(Bun.hash(png));
  let url = urls.get(key);
  if (!url) {
    url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    urls.set(key, url);
  }
  return { id, path: url, width: w, height: h };
}
