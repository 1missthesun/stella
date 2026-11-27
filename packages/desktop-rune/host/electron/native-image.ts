// nativeImage over encoded PNG/JPEG bytes; resizing, cropping and re-encoding go through
// photon (the WASM image library Electron main already depends on), loaded on first use.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { jpegSize, pngSize } from "./encoded-image-size";

type Photon = typeof import("@silvia-odwyer/photon-node");
type PhotonImage = InstanceType<Photon["PhotonImage"]>;

let photon: Photon | null = null;
const loadPhoton = (): Photon => {
  photon ??= createRequire(path.join(import.meta.dir, "../../../desktop/package.json"))("@silvia-odwyer/photon-node") as Photon;
  return photon;
};

type Size = { width: number; height: number };

export class NativeImage {
  private size: Size | null = null;
  private template = false;

  constructor(private bytes: Uint8Array | null, private readonly rgba?: { pixels: Uint8Array; width: number; height: number }, private readonly scaleFactor = 1) {
    if (rgba) this.size = { width: rgba.width, height: rgba.height };
    else if (bytes) this.size = pngSize(bytes) ?? jpegSize(bytes);
  }

  private photonImage(): PhotonImage | null {
    const p = loadPhoton();
    if (this.rgba) return new p.PhotonImage(this.rgba.pixels, this.rgba.width, this.rgba.height);
    if (!this.bytes || this.bytes.length === 0) return null;
    return p.PhotonImage.new_from_byteslice(this.bytes);
  }

  isEmpty() { return !this.rgba && (!this.bytes || this.bytes.length === 0); }

  getSize(_scale?: number): Size {
    if (this.size) return { ...this.size };
    if (this.isEmpty()) return { width: 0, height: 0 };
    const img = this.photonImage();
    this.size = img ? { width: img.get_width(), height: img.get_height() } : { width: 0, height: 0 };
    img?.free();
    return { ...this.size };
  }

  getAspectRatio() { const s = this.getSize(); return s.height ? s.width / s.height : 1; }
  getScaleFactors() { return [this.scaleFactor]; }

  toPNG(_options?: unknown): Buffer {
    if (this.isEmpty()) return Buffer.alloc(0);
    if (this.bytes && pngSize(this.bytes)) return Buffer.from(this.bytes);
    const img = this.photonImage()!;
    try { return Buffer.from(img.get_bytes()); } finally { img.free(); }
  }

  toJPEG(quality: number): Buffer {
    if (this.isEmpty()) return Buffer.alloc(0);
    const img = this.photonImage()!;
    try { return Buffer.from(img.get_bytes_jpeg(quality)); } finally { img.free(); }
  }

  toBitmap(): Buffer {
    if (this.rgba) return rgbaToBgra(this.rgba.pixels);
    const img = this.photonImage();
    if (!img) return Buffer.alloc(0);
    try { return rgbaToBgra(img.get_raw_pixels()); } finally { img.free(); }
  }

  getBitmap() { return this.toBitmap(); }

  toDataURL(): string {
    if (this.isEmpty()) return "data:image/png;base64,";
    const png = this.toPNG();
    return `data:image/png;base64,${png.toString("base64")}`;
  }

  getNativeHandle() { return Buffer.alloc(0); }

  resize(options: { width?: number; height?: number; quality?: string }): NativeImage {
    const s = this.getSize();
    if (!s.width || !s.height) return this;
    const width = Math.max(1, Math.round(options.width ?? (options.height ? (s.width * options.height) / s.height : s.width)));
    const height = Math.max(1, Math.round(options.height ?? (options.width ? (s.height * options.width) / s.width : s.height)));
    const p = loadPhoton();
    const img = this.photonImage()!;
    const filter = options.quality === "good" || options.quality === "best" ? p.SamplingFilter.Lanczos3 : p.SamplingFilter.Triangle;
    const out = p.resize(img, width, height, filter);
    img.free();
    try { return new NativeImage(out.get_bytes()); } finally { out.free(); }
  }

  crop(rect: { x: number; y: number; width: number; height: number }): NativeImage {
    const p = loadPhoton();
    const img = this.photonImage();
    if (!img) return this;
    const out = p.crop(img, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    img.free();
    try { return new NativeImage(out.get_bytes()); } finally { out.free(); }
  }

  addRepresentation(options: { buffer?: Uint8Array; dataURL?: string }) {
    if (this.isEmpty()) {
      if (options.buffer) this.bytes = options.buffer;
      else if (options.dataURL) this.bytes = fromDataUrl(options.dataURL);
      if (this.bytes) this.size = pngSize(this.bytes) ?? jpegSize(this.bytes);
    }
  }

  setTemplateImage(on: boolean) { this.template = on; }
  isTemplateImage() { return this.template; }
  get isMacTemplateImage() { return this.template; }
}

const rgbaToBgra = (pixels: Uint8Array) => {
  const out = Buffer.from(pixels);
  for (let i = 0; i < out.length; i += 4) { const r = out[i]!; out[i] = out[i + 2]!; out[i + 2] = r; }
  return out;
};

const fromDataUrl = (url: string): Uint8Array | null => {
  const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!m) return null;
  return m[2] ? Buffer.from(m[3]!, "base64") : Buffer.from(decodeURIComponent(m[3]!));
};

export const nativeImage = {
  createEmpty: () => new NativeImage(null),
  createFromPath: (file: string) => {
    try { return new NativeImage(readFileSync(file)); } catch { return new NativeImage(null); }
  },
  createFromBuffer: (buffer: Uint8Array, options?: { width?: number; height?: number; scaleFactor?: number }) => {
    if (options?.width && options.height && !pngSize(buffer) && !jpegSize(buffer)) {
      return new NativeImage(null, { pixels: Uint8Array.from(rgbaToBgra(buffer)), width: options.width, height: options.height }, options.scaleFactor);
    }
    return new NativeImage(buffer, undefined, options?.scaleFactor);
  },
  createFromBitmap: (buffer: Uint8Array, options: { width: number; height: number; scaleFactor?: number }) =>
    new NativeImage(null, { pixels: Uint8Array.from(rgbaToBgra(buffer)), width: options.width, height: options.height }, options.scaleFactor),
  createFromDataURL: (url: string) => new NativeImage(fromDataUrl(url)),
  createFromNamedImage: () => new NativeImage(null),
  createThumbnailFromPath: async (file: string, size: { width: number; height: number }) =>
    nativeImage.createFromPath(file).resize({ width: size.width, height: size.height }),
};
