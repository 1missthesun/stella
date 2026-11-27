type Size = { width: number; height: number };

export const pngSize = (b: Uint8Array): Size | null =>
  b.length > 24 && b[0] === 0x89 && b[1] === 0x50
    ? { width: new DataView(b.buffer, b.byteOffset).getUint32(16), height: new DataView(b.buffer, b.byteOffset).getUint32(20) }
    : null;

export const jpegSize = (b: Uint8Array): Size | null => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
    }
    i += 2 + len;
  }
  return null;
};

export const encodedImageSize = (bytes: Uint8Array): Size | null => pngSize(bytes) ?? jpegSize(bytes);
