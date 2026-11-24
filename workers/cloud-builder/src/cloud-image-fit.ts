// workerd cannot host Photon: its Node build compiles WASM from bytes read off disk.

import {
  base64EncodedLength,
  formatImageResizeNote,
  type ImageCaps,
  imageFitPasses,
  imageFitsCaps,
} from "@stella/runtime/kernel/shared/image-caps.js";
import { detectImageMediaType } from "@stella/runtime/kernel/shared/image-payload.js";

export type FittedImage = {
  bytes: Uint8Array;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  note?: string;
};

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new Response(bytes).body as ReadableStream<Uint8Array>;

const dimensionsOf = async (
  images: ImagesBinding,
  bytes: Uint8Array,
): Promise<{ width: number; height: number } | null> => {
  const info = await images.info(streamOf(bytes));
  if (!("width" in info) || !(info.width > 0) || !(info.height > 0)) {
    return null;
  }
  return { width: info.width, height: info.height };
};

export const fitImageWithImagesBinding = async (
  images: ImagesBinding,
  bytes: Uint8Array,
  mimeType: string,
  caps: ImageCaps,
): Promise<FittedImage | null> => {
  try {
    const original = await dimensionsOf(images, bytes);
    if (!original) return null;
    if (imageFitsCaps(caps, original.width, original.height, bytes.byteLength, mimeType)) {
      return {
        bytes,
        mimeType,
        originalWidth: original.width,
        originalHeight: original.height,
      };
    }
    for (const pass of imageFitPasses(caps, original.width, original.height, mimeType)) {
      for (const encoding of pass.encodings) {
        const result = await images
          .input(streamOf(bytes))
          .transform({ width: pass.width, height: pass.height, fit: "scale-down" })
          .output(encoding.format === "image/png" ? { format: "image/png" } : { format: "image/jpeg", quality: encoding.quality });
        const encoded = new Uint8Array(await result.response().arrayBuffer());
        if (base64EncodedLength(encoded.byteLength) >= pass.maxBytes) continue;
        const outputMimeType = detectImageMediaType(encoded);
        if (!outputMimeType) return null;
        const shown = (await dimensionsOf(images, encoded)) ?? { width: pass.width, height: pass.height };
        return {
          bytes: encoded,
          mimeType: outputMimeType,
          originalWidth: original.width,
          originalHeight: original.height,
          note: formatImageResizeNote({
            originalWidth: original.width,
            originalHeight: original.height,
            originalBytes: bytes.byteLength,
            originalMimeType: mimeType,
            width: shown.width,
            height: shown.height,
            bytes: encoded.byteLength,
            mimeType: outputMimeType,
          }),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
};
