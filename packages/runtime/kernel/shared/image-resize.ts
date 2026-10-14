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
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  jpegQuality?: number;
}

export interface ResizedImage {
  data: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}

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
    const qualitySteps = jpegQualitySteps(opts.jpegQuality);

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
