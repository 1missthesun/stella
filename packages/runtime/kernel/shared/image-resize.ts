import {
  DEFAULT_JPEG_QUALITY,
  formatImageResizeNote,
  type ImageCaps,
  imageFitPasses,
  imageFitsCaps,
  SAFE_FALLBACK_MAX_BYTES,
  SAFE_FALLBACK_MAX_EDGE,
} from "./image-caps.js";
import { applyExifOrientation } from "./exif-orientation.js";
import { loadPhoton } from "./photon.js";
import { encodePng } from "./png-encode.js";

export type ImageResizeOptions = Partial<ImageCaps>;

export interface ResizedImage {
  data: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  wasResized: boolean;
}

const DEFAULT_OPTIONS: ImageCaps = {
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
  const opts: ImageCaps = { ...DEFAULT_OPTIONS, ...options };

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
      imageFitsCaps(opts, originalWidth, originalHeight, inputBytes.byteLength, mimeType)
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

    for (const pass of imageFitPasses(opts, originalWidth, originalHeight, mimeType)) {
      const resized = photon.resize(image, pass.width, pass.height, photon.SamplingFilter.Lanczos3);
      try {
        for (const encoding of pass.encodings) {
          const candidate =
            encoding.format === "image/png"
              ? encodeCandidate(encodePng(resized.get_raw_pixels(), resized.get_width(), resized.get_height()), "image/png")
              : encodeCandidate(resized.get_bytes_jpeg(encoding.quality), "image/jpeg");
          if (candidate.encodedSize >= pass.maxBytes) continue;
          return {
            data: candidate.data,
            mimeType: candidate.mimeType,
            originalWidth,
            originalHeight,
            width: pass.width,
            height: pass.height,
            wasResized: true,
          };
        }
      } finally {
        resized.free();
      }
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
