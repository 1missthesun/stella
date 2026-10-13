const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let out = "";
  for (let index = offset; index < offset + length && index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]!);
  }
  return out;
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);

const ISO_BRANDS: Record<string, string> = {
  avif: "image/avif",
  avis: "image/avif",
  heic: "image/heic",
  heix: "image/heic",
  mif1: "image/heif",
  msf1: "image/heif",
  "qt  ": "video/quicktime",
  "M4A ": "audio/mp4",
  "M4B ": "audio/mp4",
  isom: "video/mp4",
  iso2: "video/mp4",
  iso4: "video/mp4",
  iso5: "video/mp4",
  iso6: "video/mp4",
  mp41: "video/mp4",
  mp42: "video/mp4",
  avc1: "video/mp4",
  dash: "video/mp4",
  "M4V ": "video/mp4",
  "3gp4": "video/3gpp",
  "3gp5": "video/3gpp",
  "3g2a": "video/3gpp2",
};

export const sniffMediaInputType = (bytes: Uint8Array): string | undefined => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "audio/wav";
  if (ascii(bytes, 0, 2) === "BM" && bytes.length > 26) return "image/bmp";
  if (ascii(bytes, 4, 4) === "ftyp") return ISO_BRANDS[ascii(bytes, 8, 4)];
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1]! & 0xf6) === 0xf0)) return "audio/aac";
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  return undefined;
};

const family = (contentType: string): string => contentType.split("/")[0] ?? "";

export const mediaInputTypeError = (declared: string, bytes: Uint8Array): string | null => {
  const sniffed = sniffMediaInputType(bytes);
  if (!sniffed) {
    return "Media inputs must be an image (PNG, JPEG, GIF, WebP, AVIF, HEIC, BMP), video (MP4, MOV, WebM) or audio (MP3, AAC, M4A, WAV, OGG, FLAC) file; this file's content is none of those.";
  }
  const declaredType = declared.split(";")[0]!.trim().toLowerCase();
  const generic = declaredType === "" || declaredType === "application/octet-stream";
  const declaredFamily = family(declaredType);
  const sniffedFamily = family(sniffed);
  const compatible =
    generic ||
    declaredFamily === sniffedFamily ||
    (declaredFamily === "audio" && sniffed === "video/mp4") ||
    (declaredFamily === "video" && sniffed === "audio/mp4");
  return compatible
    ? null
    : `A media input declared as ${declaredType} contains ${sniffed} data; send it with its real type.`;
};
