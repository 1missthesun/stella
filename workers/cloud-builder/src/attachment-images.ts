/**
 * The model-ready copy of an image a chat attached from the Drive.
 *
 * A chat attachment is uploaded to the Drive as soon as it is attached, and
 * the owner prepares its model-ready copy in the background as the upload
 * finalizes (`prepareChatImage` in the Drive domain), so sending the turn only copies
 * a ready object into the conversation. The copy lives at
 * `conversation-images/<owner hash>/attachments/<hash of the Drive key>`:
 *
 * - an image already within the model's limits (clients resize on attach) is
 *   copied server-side by R2, with no bytes through the isolate;
 * - anything else (an older client, a raw phone photo) is fitted with the
 *   Images binding, the safety net.
 *
 * A send that finds no prepared copy (sent before the background job ran)
 * prepares it the same way on the spot. The copy goes when its Drive object
 * is retired, and with the owner.
 */

import { DURABLE_OBJECT_READ_IMAGE_CAPS, imageFitsCaps, READ_IMAGE_MAX_SOURCE_BYTES } from "@stella/runtime/kernel/shared/image-caps.js";
import { fitImageWithImagesBinding } from "./cloud-image-fit.js";
import { ownerConversationImagesPrefix } from "./conversation-images.js";
import { sha256Hex } from "./hash.js";
import { copyR2Object, r2Signer } from "./r2-presign.js";

export type AttachmentImagesEnv = Pick<
  Cloudflare.Env,
  "DRIVE" | "R2_DRIVE_BUCKET" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_S3_ENDPOINT"
> & { IMAGES?: Cloudflare.Env["IMAGES"] };

export type PreparedAttachmentImage = {
  key: string;
  mimeType: string;
  /** How it was made: already there, copied as it was, or fitted. */
  via: "ready" | "copied" | "fitted";
};

const MODEL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Enough of the file to reach a JPEG's frame header past a large EXIF block. */
const HEADER_BYTES = 256 * 1024;

export const attachmentImageKey = async (ownerId: string, driveKey: string): Promise<string> =>
  `${await ownerConversationImagesPrefix(ownerId)}attachments/${await sha256Hex(driveKey)}`;

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** The type and pixel size an image's header declares, or null when it can't be read from these bytes. */
export const imageHeaderInfo = (b: Uint8Array): { mimeType: string; width: number; height: number } | null => {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return { mimeType: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 10 && ascii(b, 0, 4) === "GIF8") {
    return { mimeType: "image/gif", width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return { mimeType: "image/webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (chunk === "VP8L") {
      return {
        mimeType: "image/webp",
        width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!),
        height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8X") return { mimeType: "image/webp", width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { mimeType: "image/jpeg", width: u16be(b, i + 7), height: u16be(b, i + 5) };
      i += 2 + u16be(b, i + 2);
    }
  }
  return null;
};

/**
 * Fitting holds the whole source (up to 20MB) and its output in the isolate,
 * so at most two run at once per isolate, beside a Durable Object's own memory.
 */
const FIT_SLOTS = 2;
let fitting = 0;
const fitWaiters: Array<() => void> = [];
const withFitSlot = async <T>(work: () => Promise<T>): Promise<T> => {
  while (fitting >= FIT_SLOTS) await new Promise<void>((resolve) => fitWaiters.push(resolve));
  fitting += 1;
  try {
    return await work();
  } finally {
    fitting -= 1;
    fitWaiters.shift()?.();
  }
};

const bytesOf = async (object: R2ObjectBody): Promise<Uint8Array> => new Uint8Array(await object.arrayBuffer());

/**
 * The prepared copy of the Drive object `driveKey` under `ownerId`: the one
 * already made, or made now. Null when the source is gone or isn't an image
 * the model can take even after fitting.
 */
export const prepareAttachmentImage = async (
  env: AttachmentImagesEnv,
  args: { ownerId: string; driveKey: string; contentType: string; sizeBytes: number },
): Promise<PreparedAttachmentImage | null> => {
  const bucket = env.DRIVE;
  if (!bucket) return null;
  const key = await attachmentImageKey(args.ownerId, args.driveKey);
  const existing = await bucket.head(key);
  const existingType = existing?.httpMetadata?.contentType;
  if (existing && existingType && MODEL_IMAGE_TYPES.has(existingType)) {
    return { key, mimeType: existingType, via: "ready" };
  }
  const caps = DURABLE_OBJECT_READ_IMAGE_CAPS;
  const header = await bucket.get(args.driveKey, { range: { offset: 0, length: HEADER_BYTES } });
  if (!header) return null;
  const info = imageHeaderInfo(await bytesOf(header));
  if (info && MODEL_IMAGE_TYPES.has(info.mimeType) && imageFitsCaps(caps, info.width, info.height, args.sizeBytes)) {
    const signer = r2Signer(env, env.R2_DRIVE_BUCKET);
    if (signer) {
      await copyR2Object(signer, { from: args.driveKey, to: key });
      // The copy keeps the source's metadata; the type the model sees is the one its bytes declare.
      const copied = await bucket.head(key);
      if (copied?.httpMetadata?.contentType === info.mimeType) return { key, mimeType: info.mimeType, via: "copied" };
    }
    const whole = await bucket.get(args.driveKey);
    if (!whole) return null;
    await bucket.put(key, await bytesOf(whole), { httpMetadata: { contentType: info.mimeType } });
    return { key, mimeType: info.mimeType, via: "copied" };
  }
  // The safety net: too large, too many pixels, or a type the model can't take.
  const images = env.IMAGES;
  if (!images || args.sizeBytes > READ_IMAGE_MAX_SOURCE_BYTES) return null;
  return await withFitSlot(async () => {
    const whole = await bucket.get(args.driveKey);
    if (!whole) return null;
    const fitted = await fitImageWithImagesBinding(images, await bytesOf(whole), args.contentType, caps).catch(() => null);
    if (!fitted || !MODEL_IMAGE_TYPES.has(fitted.mimeType)) return null;
    await bucket.put(key, fitted.bytes, { httpMetadata: { contentType: fitted.mimeType } });
    return { key, mimeType: fitted.mimeType, via: "fitted" as const };
  });
};
