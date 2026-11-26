// Decodes an image file and scales it to fit `maxEdge`, as desktop-ui's attachment preview draws it
// on a canvas; posts a JPEG (for JPEG files) or WebP data URL with the full image's size, or null when the file isn't an image.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

type Photon = typeof import("@silvia-odwyer/photon-node");

declare const self: Worker;

let photon: Photon | null = null;
const loadPhoton = (): Photon => {
  photon ??= createRequire(path.join(import.meta.dir, "../../../desktop/package.json"))("@silvia-odwyer/photon-node") as Photon;
  return photon;
};

self.onmessage = (e: MessageEvent<{ id: number; file: string; maxEdge: number }>) => {
  const { id, file, maxEdge } = e.data;
  try {
    const p = loadPhoton();
    const full = p.PhotonImage.new_from_byteslice(readFileSync(file));
    const width = full.get_width();
    const height = full.get_height();
    const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
    const preview = scale < 1 ? p.resize(full, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), p.SamplingFilter.Triangle) : full;
    const opaque = /\.jpe?g$/i.test(file);
    const bytes = opaque ? preview.get_bytes_jpeg(80) : preview.get_bytes_webp();
    if (preview !== full) preview.free();
    full.free();
    self.postMessage({ id, preview: { dataUrl: `data:image/${opaque ? "jpeg" : "webp"};base64,${Buffer.from(bytes).toString("base64")}`, width, height } });
  } catch {
    self.postMessage({ id, preview: null });
  }
};
