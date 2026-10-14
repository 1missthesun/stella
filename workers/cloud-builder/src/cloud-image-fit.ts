/**
 * Fit an image to the model's limits inside the Worker, the counterpart of the
 * runtime's Photon `resizeImage` (packages/runtime/kernel/shared/image-resize).
 *
 * workerd cannot host Photon here: its Node build compiles WASM from bytes
 * read off disk, and a full-size photo decoded into the isolate (a 12MP JPEG
 * is ~48MB of RGBA, a 24MP one ~96MB) would not fit beside a Durable Object
 * in 128MB anyway. The Images binding decodes and resizes outside the isolate.
 * Everything that decides the outcome — the caps, when an image passes
 * untouched, the aspect-preserving target, PNG-first only for graphics, the
 * JPEG quality ladder, the shrink factor, and the note the model reads — comes
 * from the shared `image-caps` module, so a Read behaves the same here as on a
 * computer or in an agent's container.
 */

import {
  base64EncodedLength,
  fitImageDimensions,
  formatImageResizeNote,
  IMAGE_SHRINK_FACTOR,
  type ImageCaps,
  imageFitsCaps,
  jpegQualitySteps,
  triesLosslessFirst,
} from "@stella/runtime/kernel/shared/image-caps.js";
import { detectImageMediaType } from "@stella/runtime/kernel/shared/image-payload.js";

export type FittedImage = {
  bytes: Uint8Array;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  note?: string;
};

const MAX_SHRINK_PASSES = 8;

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
    if (imageFitsCaps(caps, original.width, original.height, bytes.byteLength)) {
      return {
        bytes,
        mimeType,
        originalWidth: original.width,
        originalHeight: original.height,
      };
    }
    const outputs: ImageOutputOptions[] = [
      ...(triesLosslessFirst(mimeType)
        ? [{ format: "image/png" } as const]
        : []),
      ...jpegQualitySteps(caps.jpegQuality).map((quality) => ({
        format: "image/jpeg" as const,
        quality,
      })),
    ];
    let { width, height } = fitImageDimensions(
      caps,
      original.width,
      original.height,
    );
    for (let pass = 0; pass <= MAX_SHRINK_PASSES; pass += 1) {
      for (const output of outputs) {
        const result = await images
          .input(streamOf(bytes))
          .transform({ width, height, fit: "scale-down" })
          .output(output);
        const encoded = new Uint8Array(
          await result.response().arrayBuffer(),
        );
        if (base64EncodedLength(encoded.byteLength) >= caps.maxBytes) continue;
        const outputMimeType = detectImageMediaType(encoded);
        if (!outputMimeType) return null;
        const shown = (await dimensionsOf(images, encoded)) ?? { width, height };
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
      width = Math.max(1, Math.floor(width * IMAGE_SHRINK_FACTOR));
      height = Math.max(1, Math.floor(height * IMAGE_SHRINK_FACTOR));
    }
    return null;
  } catch {
    return null;
  }
};
