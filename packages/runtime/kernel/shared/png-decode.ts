import { inflateSync } from "node:zlib";

export type DecodedPng = Readonly<{
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
}>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS: Readonly<Record<number, number>> = {
  0: 1, // greyscale
  2: 3, // RGB
  4: 2, // greyscale + alpha
  6: 4, // RGBA
};

const paeth = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

/**
 * Decodes the PNGs Stella's native helpers write (8-bit greyscale, RGB or
 * RGBA, not interlaced, no palette) to RGBA. Returns null for anything else
 * so callers can fall back instead of guessing at pixels.
 */
export const decodePng = (bytes: Uint8Array): DecodedPng | null => {
  if (bytes.length < 8) return null;
  for (let index = 0; index < 8; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9]!;
      const interlace = bytes[dataStart + 12];
      channels = CHANNELS[colorType] ?? 0;
      if (bitDepth !== 8 || interlace !== 0 || channels === 0) return null;
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width <= 0 || height <= 0 || channels === 0 || idat.length === 0) {
    return null;
  }
  let raw: Uint8Array;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source + x]!;
      const left = x >= channels ? pixels[row + x - channels]! : 0;
      const up = y > 0 ? pixels[previous + x]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[previous + x - channels]! : 0;
      let decoded: number;
      switch (filter) {
        case 0:
          decoded = value;
          break;
        case 1:
          decoded = value + left;
          break;
        case 2:
          decoded = value + up;
          break;
        case 3:
          decoded = value + ((left + up) >> 1);
          break;
        case 4:
          decoded = value + paeth(left, up, upLeft);
          break;
        default:
          return null;
      }
      pixels[row + x] = decoded & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    const target = index * 4;
    if (channels === 3) {
      rgba[target] = pixels[source]!;
      rgba[target + 1] = pixels[source + 1]!;
      rgba[target + 2] = pixels[source + 2]!;
      rgba[target + 3] = 255;
    } else {
      const grey = pixels[source]!;
      rgba[target] = grey;
      rgba[target + 1] = grey;
      rgba[target + 2] = grey;
      rgba[target + 3] = channels === 2 ? pixels[source + 1]! : 255;
    }
  }
  return { width, height, rgba };
};
