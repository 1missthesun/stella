import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
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
 * RGBA pixels as a PNG, compressed the way image tools do: RGB when every
 * pixel is opaque, each row filtered with whichever of the five PNG filters
 * leaves the smallest residuals, then zlib. Photon's own PNG keeps the alpha
 * channel and filters nothing, which makes a retina screenshot ~30% larger.
 */
export const encodePng = (rgba: Uint8Array, width: number, height: number): Uint8Array => {
  let opaque = true;
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] !== 255) {
      opaque = false;
      break;
    }
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const raw = new Uint8Array(stride * height);
  if (opaque) {
    for (let pixel = 0, out = 0; pixel < rgba.length; pixel += 4, out += 3) {
      raw[out] = rgba[pixel]!;
      raw[out + 1] = rgba[pixel + 1]!;
      raw[out + 2] = rgba[pixel + 2]!;
    }
  } else {
    raw.set(rgba.subarray(0, stride * height));
  }
  const filtered = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let row = 0; row < height; row += 1) {
    const line = raw.subarray(row * stride, (row + 1) * stride);
    const above = row > 0 ? raw.subarray((row - 1) * stride, row * stride) : undefined;
    let bestFilter = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let filter = 0; filter < 5; filter += 1) {
      let score = 0;
      for (let index = 0; index < stride; index += 1) {
        const value = line[index]!;
        const left = index >= channels ? line[index - channels]! : 0;
        const up = above ? above[index]! : 0;
        const upLeft = above && index >= channels ? above[index - channels]! : 0;
        const predicted =
          filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
        const residual = (value - predicted) & 0xff;
        candidate[index] = residual;
        score += residual < 128 ? residual : 256 - residual;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best.set(candidate);
      }
    }
    const offset = row * (stride + 1);
    filtered[offset] = bestFilter;
    filtered.set(best, offset + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(filtered, { level: 6 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
