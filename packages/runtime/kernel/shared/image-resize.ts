/**
 * Vision-input image resizing, ported from pi-mono's coding-agent
 * (`utils/image-resize-core.ts`). Guarantees every attached image fits
 * within provider dimension and byte limits at attach time, so history
 * never carries multi-megabyte base64 blocks:
 *
 * 1. Resize to maxWidth/maxHeight (Lanczos3)
 * 2. Encode, picking the first encoding under maxBytes: lossless PNG first
 *    for PNG/GIF sources (text stays crisp whenever it fits), JPEG for photos
 *    (the steps, shrink factor and caps are shared from ./image-caps.ts, so
 *    the Worker's Images-binding resize walks the same ladder)
 * 3. If still too large, walk JPEG quality down (90 → 40)
 * 4. If still too large, progressively shrink dimensions toward 1x1
 *
 * When the input already fits the target's dimension AND byte caps it is
 * passed through untouched — no needless lossy re-encode.
 *
 * Runs in-process: Stella's runtime worker is already a separate process
 * from the UI, so a brief WASM decode doesn't block anything user-facing.
 * Returns null when Photon is unavailable or the image can't be decoded
 * or shrunk under the cap — callers decide the fallback.
 */

import {
  DEFAULT_JPEG_QUALITY,
  fitImageDimensions,
  formatImageResizeNote,
  IMAGE_SHRINK_FACTOR,
  imageFitsCaps,
  jpegQualitySteps,
  SAFE_FALLBACK_MAX_BYTES,
  SAFE_FALLBACK_MAX_EDGE,
  triesLosslessFirst,
} from "./image-caps.js";
import { applyExifOrientation } from "./exif-orientation.js";
import { loadPhoton } from "./photon.js";

export interface ImageResizeOptions {
  maxWidth?: number; // Default: safe-fallback long edge (2048)
  maxHeight?: number; // Default: safe-fallback long edge (2048)
  maxBytes?: number; // Default: safe-fallback base64 budget (~4.5MB)
  jpegQuality?: number; // Default: 90
}

export interface ResizedImage {
  data: string; // base64
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}

// Safe conservative defaults, used only when a caller does not pass
// provider-aware caps. Callers should resolve caps via `resolveImageCaps`
// (ai/utils/image-caps) so images reach each provider at the best quality it
// supports; these defaults stay under every mainstream provider's per-image
// cap for the unknown-route case.
const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
  maxWidth: SAFE_FALLBACK_MAX_EDGE,
  maxHeight: SAFE_FALLBACK_MAX_EDGE,
  maxBytes: SAFE_FALLBACK_MAX_BYTES,
  jpegQuality: DEFAULT_JPEG_QUALITY,
};

interface EncodedCandidate {
  data: string;
  encodedSize: number;
  mimeType: string;
}

const encodeCandidate = (
  buffer: Uint8Array,
  mimeType: string,
): EncodedCandidate => {
  const data = Buffer.from(buffer).toString("base64");
  return {
    data,
    encodedSize: Buffer.byteLength(data, "utf-8"),
    mimeType,
  };
};

export const resizeImage = async (
  inputBytes: Uint8Array,
  mimeType: string,
  options?: ImageResizeOptions,
): Promise<ResizedImage | null> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const photon = await loadPhoton();
  if (!photon) {
    return null;
  }

  let image:
    | ReturnType<typeof photon.PhotonImage.new_from_byteslice>
    | undefined;
  try {
    const rawImage = photon.PhotonImage.new_from_byteslice(inputBytes);
    image = applyExifOrientation(photon, rawImage, inputBytes);
    if (image !== rawImage) rawImage.free();

    const originalWidth = image.get_width();
    const originalHeight = image.get_height();
    const format = mimeType.split("/")[1] ?? "png";

    // Already within all limits (dimensions AND encoded size): untouched.
    if (
      imageFitsCaps(opts, originalWidth, originalHeight, inputBytes.byteLength)
    ) {
      return {
        data: Buffer.from(inputBytes).toString("base64"),
        mimeType: mimeType || `image/${format}`,
        originalWidth,
        originalHeight,
        width: originalWidth,
        height: originalHeight,
        wasResized: false,
      };
    }

    const target = fitImageDimensions(opts, originalWidth, originalHeight);
    const losslessFirst = triesLosslessFirst(mimeType);
    // Try the caller's quality first (default q90), then step down only as
    // needed to fit the byte cap; heavy JPEG compression is the classic cause
    // of illegible text, so we start high rather than at the old q80.
    const qualitySteps = jpegQualitySteps(opts.jpegQuality);

    /** The first encoding at this size under the byte cap, encoding lazily. */
    const firstFitting = (
      width: number,
      height: number,
    ): EncodedCandidate | undefined => {
      const resized = photon.resize(
        image!,
        width,
        height,
        photon.SamplingFilter.Lanczos3,
      );
      try {
        if (losslessFirst) {
          const png = encodeCandidate(resized.get_bytes(), "image/png");
          if (png.encodedSize < opts.maxBytes) return png;
        }
        for (const quality of qualitySteps) {
          const jpeg = encodeCandidate(
            resized.get_bytes_jpeg(quality),
            "image/jpeg",
          );
          if (jpeg.encodedSize < opts.maxBytes) return jpeg;
        }
        return undefined;
      } finally {
        resized.free();
      }
    };

    let currentWidth = target.width;
    let currentHeight = target.height;

    while (true) {
      const candidate = firstFitting(currentWidth, currentHeight);
      if (candidate) {
        return {
          data: candidate.data,
          mimeType: candidate.mimeType,
          originalWidth,
          originalHeight,
          width: currentWidth,
          height: currentHeight,
          wasResized: true,
        };
      }

      if (currentWidth === 1 && currentHeight === 1) {
        break;
      }

      const nextWidth =
        currentWidth === 1
          ? 1
          : Math.max(1, Math.floor(currentWidth * IMAGE_SHRINK_FACTOR));
      const nextHeight =
        currentHeight === 1
          ? 1
          : Math.max(1, Math.floor(currentHeight * IMAGE_SHRINK_FACTOR));
      if (nextWidth === currentWidth && nextHeight === currentHeight) {
        break;
      }

      currentWidth = nextWidth;
      currentHeight = nextHeight;
    }

    return null;
  } catch {
    return null;
  } finally {
    if (image) {
      image.free();
    }
  }
};

/**
 * The model-visible note for a resized image (see `formatImageResizeNote`),
 * or undefined when it was passed through untouched.
 */
export const formatDimensionNote = (
  result: ResizedImage,
  original: { bytes: number; mimeType: string },
): string | undefined => {
  if (!result.wasResized) {
    return undefined;
  }
  return formatImageResizeNote({
    originalWidth: result.originalWidth,
    originalHeight: result.originalHeight,
    originalBytes: original.bytes,
    originalMimeType: original.mimeType,
    width: result.width,
    height: result.height,
    bytes: Buffer.byteLength(result.data, "base64"),
    mimeType: result.mimeType,
  });
};
