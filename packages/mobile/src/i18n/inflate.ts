/**
 * Minimal zero-dependency RFC 1951 raw-DEFLATE + single-entry ZIP extractor
 * for unpacking compressed mobile locale packs (`src/i18n/packs/*.zip`)
 * without adding any native dependency.
 */

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];
const CL_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

type HuffTable = {
  counts: Int32Array;
  symbols: Int32Array;
  maxBits: number;
};

const buildHuffman = (lengths: Uint8Array, start: number, count: number): HuffTable => {
  const counts = new Int32Array(16);
  let maxBits = 0;
  for (let i = 0; i < count; i += 1) {
    const len = lengths[start + i]!;
    if (len > 0) {
      counts[len] = counts[len]! + 1;
      if (len > maxBits) maxBits = len;
    }
  }
  const offsets = new Int32Array(16);
  for (let bits = 1; bits < 15; bits += 1) {
    offsets[bits + 1] = offsets[bits]! + counts[bits]!;
  }
  const symbols = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const len = lengths[start + i]!;
    if (len > 0) {
      symbols[offsets[len]!] = i;
      offsets[len] = offsets[len]! + 1;
    }
  }
  return { counts, symbols, maxBits };
};

const FIXED_LIT = (() => {
  const lens = new Uint8Array(288);
  lens.fill(8, 0, 144);
  lens.fill(9, 144, 256);
  lens.fill(7, 256, 280);
  lens.fill(8, 280, 288);
  return buildHuffman(lens, 0, 288);
})();

const FIXED_DIST = (() => {
  const lens = new Uint8Array(32);
  lens.fill(5);
  return buildHuffman(lens, 0, 32);
})();

export function inflateRaw(src: Uint8Array, expectedSize = 0): Uint8Array {
  let bytePos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const readBits = (n: number): number => {
    while (bitCount < n) {
      if (bytePos >= src.length) throw new Error("Unexpected end of deflate stream");
      bitBuf |= src[bytePos++]! << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const decodeSymbol = (table: HuffTable): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= table.maxBits; len += 1) {
      code |= readBits(1);
      const count = table.counts[len]!;
      if (code - count < first) {
        return table.symbols[index + (code - first)]!;
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error("Invalid Huffman code in deflate stream");
  };

  let out = new Uint8Array(Math.max(expectedSize, src.length * 3, 256));
  let outPos = 0;

  const ensure = (extra: number) => {
    if (outPos + extra <= out.length) return;
    let nextLen = out.length * 2;
    while (nextLen < outPos + extra) nextLen *= 2;
    const grown = new Uint8Array(nextLen);
    grown.set(out.subarray(0, outPos));
    out = grown;
  };

  let finalBlock = 0;
  while (!finalBlock) {
    finalBlock = readBits(1);
    const blockType = readBits(2);

    if (blockType === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (bytePos + 4 > src.length) throw new Error("Truncated stored deflate block");
      const len = src[bytePos]! | (src[bytePos + 1]! << 8);
      const nlen = src[bytePos + 2]! | (src[bytePos + 3]! << 8);
      bytePos += 4;
      if ((len ^ 0xffff) !== nlen) throw new Error("Corrupt stored deflate block");
      ensure(len);
      out.set(src.subarray(bytePos, bytePos + len), outPos);
      bytePos += len;
      outPos += len;
      continue;
    }

    let litTable: HuffTable;
    let distTable: HuffTable;

    if (blockType === 1) {
      litTable = FIXED_LIT;
      distTable = FIXED_DIST;
    } else if (blockType === 2) {
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;
      const clLens = new Uint8Array(19);
      for (let i = 0; i < hclen; i += 1) {
        clLens[CL_ORDER[i]!] = readBits(3);
      }
      const clTable = buildHuffman(clLens, 0, 19);
      const total = hlit + hdist;
      const lengths = new Uint8Array(total);
      let idx = 0;
      while (idx < total) {
        const sym = decodeSymbol(clTable);
        if (sym < 16) {
          lengths[idx++] = sym;
        } else {
          let repeat = 0;
          let value = 0;
          if (sym === 16) {
            if (idx === 0) throw new Error("Invalid repeat in deflate header");
            value = lengths[idx - 1]!;
            repeat = readBits(2) + 3;
          } else if (sym === 17) {
            repeat = readBits(3) + 3;
          } else {
            repeat = readBits(7) + 11;
          }
          if (idx + repeat > total) throw new Error("Overflow in deflate code lengths");
          lengths.fill(value, idx, idx + repeat);
          idx += repeat;
        }
      }
      litTable = buildHuffman(lengths, 0, hlit);
      distTable = buildHuffman(lengths, hlit, hdist);
    } else {
      throw new Error(`Unsupported deflate block type ${blockType}`);
    }

    for (;;) {
      const sym = decodeSymbol(litTable);
      if (sym < 256) {
        ensure(1);
        out[outPos++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const lenIdx = sym - 257;
        const length = LEN_BASE[lenIdx]! + (LEN_EXTRA[lenIdx]! ? readBits(LEN_EXTRA[lenIdx]!) : 0);
        const distSym = decodeSymbol(distTable);
        const dist = DIST_BASE[distSym]! + (DIST_EXTRA[distSym]! ? readBits(DIST_EXTRA[distSym]!) : 0);
        if (dist > outPos) throw new Error("Invalid back-reference distance in deflate stream");
        ensure(length);
        for (let i = 0; i < length; i += 1) {
          out[outPos] = out[outPos - dist]!;
          outPos += 1;
        }
      }
    }
  }

  return out.subarray(0, outPos);
}

const decodeUtf8 = (bytes: Uint8Array): string => {
  if (typeof TextDecoder === "function") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++]!;
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c < 0xe0) {
      const c2 = bytes[i++]!;
      out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
    } else if (c < 0xf0) {
      const c2 = bytes[i++]!;
      const c3 = bytes[i++]!;
      out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
    } else {
      const c2 = bytes[i++]!;
      const c3 = bytes[i++]!;
      const c4 = bytes[i++]!;
      const cp = (((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * Extracts the first entry from a standard single-file ZIP archive (`PK\x03\x04`)
 * and decodes its UTF-8 text payload. The entry's size and CRC-32 must match
 * the header: a damaged pack throws (the caller falls back to English) instead
 * of yielding text that still parses but says something else.
 */
export function extractSingleZipUtf8(zipBytes: Uint8Array): string {
  if (
    zipBytes.length < 30 ||
    zipBytes[0] !== 0x50 ||
    zipBytes[1] !== 0x4b ||
    zipBytes[2] !== 0x03 ||
    zipBytes[3] !== 0x04
  ) {
    throw new Error("Invalid locale pack archive header");
  }
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const method = view.getUint16(8, true);
  const expectedCrc = view.getUint32(14, true);
  const compressedSize = view.getUint32(18, true);
  const uncompressedSize = view.getUint32(22, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataOffset = 30 + nameLen + extraLen;
  if (dataOffset + compressedSize > zipBytes.length) {
    throw new Error("Truncated locale pack archive");
  }
  const payload = zipBytes.subarray(dataOffset, dataOffset + compressedSize);
  let data: Uint8Array;
  if (method === 0) {
    data = payload;
  } else if (method === 8) {
    data = inflateRaw(payload, uncompressedSize);
  } else {
    throw new Error(`Unsupported locale pack compression method ${method}`);
  }
  if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
    throw new Error("Locale pack failed its integrity check");
  }
  return decodeUtf8(data);
}
