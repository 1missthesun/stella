import { isImageRef } from "./image-ref.js";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import { ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES } from "./image-caps.js";

export type SupportedImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

const SUPPORTED_MEDIA_TYPES: readonly SupportedImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

export const MAX_IMAGE_BASE64_BYTES = ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES;

const DATA_URL_PREFIX_RE = /^data:([^;,]+)(;base64)?,/i;

export const detectImageMediaType = (
  bytes: Uint8Array,
): SupportedImageMediaType | null => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif";
    }
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === "RIFF" && webp === "WEBP") {
      return "image/webp";
    }
  }
  return null;
};

/**
 * Bounded trailing windows for terminator scans (see `tailContainsMarker`).
 * The distinctive multi-byte markers (PNG's IEND+CRC, JPEG's EOI) tolerate a
 * wider window without false-accepting a truncated stream; GIF's single-byte
 * trailer needs a tight window so a cut-off LZW stream (whose bytes can be
 * anything, incl. 0x3B) doesn't read as complete.
 */
const MULTIBYTE_TERMINATOR_SCAN_WINDOW = 256;
const GIF_TERMINATOR_SCAN_WINDOW = 8;

/**
 * Scan the trailing `window` bytes for `marker`, matching it anywhere in that
 * window rather than requiring it to be the exact final bytes. Real, valid
 * images frequently carry a little data after their terminator (exporter
 * metadata after a PNG's IEND, padding or an appended thumbnail after a JPEG's
 * EOI); demanding an exact tail match false-rejects them and drops a good
 * image to a "[Image omitted]" note. The window stays bounded and we only scan
 * the tail — a genuinely truncated stream (no terminator present near the end)
 * is still rejected, so truncation detection isn't weakened.
 */
const tailContainsMarker = (
  bytes: Uint8Array,
  marker: readonly number[],
  window: number,
): boolean => {
  if (marker.length === 0 || bytes.length < marker.length) return false;
  const lastStart = bytes.length - marker.length;
  const earliestStart = Math.max(0, bytes.length - window);
  for (let i = lastStart; i >= earliestStart; i--) {
    let matched = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
};

export const isCompleteImage = (
  bytes: Uint8Array,
  mediaType: SupportedImageMediaType,
): boolean => {
  switch (mediaType) {
    case "image/png": {
      // A complete PNG ends with the IEND chunk: "IEND" + its fixed CRC
      // (0xAE426082). The chunk carries no data, so the CRC is constant.
      if (bytes.length < 12) return false;
      return tailContainsMarker(
        bytes,
        [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
        MULTIBYTE_TERMINATOR_SCAN_WINDOW,
      );
    }
    case "image/jpeg": {
      // Complete JPEGs end with the EOI marker 0xFFD9.
      if (bytes.length < 4) return false;
      return tailContainsMarker(bytes, [0xff, 0xd9], MULTIBYTE_TERMINATOR_SCAN_WINDOW);
    }
    case "image/gif": {
      // Complete GIFs end with the trailer byte 0x3B.
      if (bytes.length < 6) return false;
      return tailContainsMarker(bytes, [0x3b], GIF_TERMINATOR_SCAN_WINDOW);
    }
    case "image/webp": {
      // The RIFF header declares the payload size in bytes 4..8 (LE);
      // the file is complete when it contains that many bytes after the
      // 8-byte RIFF/size preamble. Read as unsigned (`>>> 0`) so a
      // declared size with bit 31 set (>= 2GiB) doesn't come out negative
      // from the signed `<< 24` and wrongly pass the length check.
      if (bytes.length < 12) return false;
      const declared =
        (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
      return bytes.length >= declared + 8;
    }
  }
};

const stripDataUrlPrefix = (data: string): string => {
  const match = DATA_URL_PREFIX_RE.exec(data);
  return match ? data.slice(match[0].length) : data;
};

const decodeBase64 = (data: string): Uint8Array | null => {
  const trimmed = stripDataUrlPrefix(data).trim();
  if (trimmed.length === 0) return null;
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
};

export interface SanitizedImagePayload {
  mediaType: SupportedImageMediaType;
  data: string;
}

export const sanitizeInlineImagePayload = (
  data: string,
  declaredMimeType: string | undefined,
): SanitizedImagePayload | null => {
  if (typeof data !== "string") return null;
  const bytes = decodeBase64(data);
  if (!bytes) return null;

  const detected = detectImageMediaType(bytes);
  const declared = declaredMimeType?.split(";")[0]?.trim().toLowerCase();
  const mediaType =
    detected ??
    (declared && SUPPORTED_MEDIA_TYPES.includes(declared as SupportedImageMediaType)
      ? (declared as SupportedImageMediaType)
      : null);

  if (!mediaType) return null;
  if (!detected) return null;

  if (!isCompleteImage(bytes, mediaType)) return null;

  const clean = stripDataUrlPrefix(data).trim();
  if (clean.length > MAX_IMAGE_BASE64_BYTES) return null;

  return { mediaType, data: clean };
};

export const UNPROCESSABLE_IMAGE_NOTE =
  "[Image omitted: it could not be decoded as a valid image and was skipped.]";

const processable = (
  block: TextContent | ImageContent,
): TextContent | ImageContent => {
  if (block.type !== "image") return block;
  if (isImageRef(block.data)) return block;
  const sanitized = sanitizeInlineImagePayload(block.data, block.mimeType);
  if (!sanitized) return { type: "text", text: UNPROCESSABLE_IMAGE_NOTE };
  return sanitized.data === block.data && sanitized.mediaType === block.mimeType
    ? block
    : { ...block, data: sanitized.data, mimeType: sanitized.mediaType };
};

/**
 * A provider decodes images server-side and fails the whole request for one
 * it can't (Anthropic: `400 "Could not process image"`), and the block stays
 * in history, so every image is checked again right before it is sent.
 */
export const withProcessableImages = <M extends Message>(
  messages: readonly M[],
): readonly M[] => {
  let changed = false;
  const next = messages.map((message) => {
    if (message.role === "assistant" || typeof message.content === "string") {
      return message;
    }
    const content = (message.content as (TextContent | ImageContent)[]).map(
      processable,
    );
    if (content.every((block, index) => block === message.content[index])) {
      return message;
    }
    changed = true;
    return { ...message, content } as M;
  });
  return changed ? next : messages;
};
