export interface ImageCaps {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
  jpegQuality: number;
  targetBytes?: number;
  minEdge?: number;
  photoEdge?: number;
}

export interface ImageCapTarget {
  provider?: string;
  api?: string;
  modelId?: string;
  imageCount?: number;
  detailOriginal?: boolean;
}

/** Anthropic's documented per-image base64 ceiling on the direct API; the wire rejects anything above it. */
export const ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;

export const ANTHROPIC_HIGH_RES_MAX_EDGE = 2576;
export const ANTHROPIC_STANDARD_MAX_EDGE = 1568;
export const ANTHROPIC_HARD_MAX_EDGE = 8000;

export const OPENAI_MAX_EDGE = 2048;
export const OPENAI_ORIGINAL_MAX_EDGE = 6000;

export const GOOGLE_MAX_EDGE = 3072;

// Anthropic: a request with more than 20 image blocks caps each at 2000px.

export const MANY_IMAGE_THRESHOLD = 20;
export const MANY_IMAGE_MAX_EDGE = 2000;

export const SAFE_FALLBACK_MAX_EDGE = 2048;

export const CONTEXT_IMAGE_MAX_EDGE = 2576;
export const CONTEXT_PHOTO_MAX_EDGE = 2000;
export const CONTEXT_IMAGE_MIN_EDGE = 1568;
export const CONTEXT_LOSSLESS_TARGET_BYTES = base64EncodedLengthOf(1.5 * 1024 * 1024);
export const CONTEXT_IMAGE_TARGET_BYTES = base64EncodedLengthOf(1024 * 1024);
export const SAFE_FALLBACK_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

const ANTHROPIC_DIRECT_RESIZE_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);
const GENEROUS_RESIZE_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);

export const DEFAULT_JPEG_QUALITY = 90;

export const CONTEXT_IMAGE_MIN_JPEG_QUALITY = 80;

const normalize = (value: string | undefined): string =>
  value?.trim().toLowerCase() ?? "";

export const isAnthropicStandardTierModel = (modelId: string): boolean => {
  const id = normalize(modelId);
  if (!id) return false;
  if (/opus-?4|sonnet-?4-5|sonnet-?4\.5|sonnet-?5|fable|mythos/.test(id)) {
    return false;
  }
  return /claude-?2|claude-?3|claude-?instant|-3-5-|-3\.5-|-3-7-|-3\.7-/.test(
    id,
  );
};

const anthropicByteCap = (
  detailOriginal: boolean,
): { resize: number; hard: number } => {
  return {
    resize: detailOriginal
      ? ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES
      : ANTHROPIC_DIRECT_RESIZE_MAX_BYTES,
    hard: ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES,
  };
};

const isAnthropicFamily = (provider: string, api: string): boolean =>
  provider === "anthropic" || api === "anthropic-messages";

const isOpenAIFamily = (provider: string, api: string): boolean =>
  provider === "openai" ||
  provider === "chatgpt" ||
  api.startsWith("openai-");

const isGoogleFamily = (provider: string, api: string): boolean =>
  provider === "google" ||
  api === "google-generative-ai";

const contextFit = (
  maxEdge: number,
): Pick<ImageCaps, "maxWidth" | "maxHeight" | "targetBytes" | "minEdge" | "photoEdge"> => {
  const edge = Math.min(maxEdge, CONTEXT_IMAGE_MAX_EDGE);
  return {
    maxWidth: edge,
    maxHeight: edge,
    targetBytes: CONTEXT_IMAGE_TARGET_BYTES,
    minEdge: Math.min(edge, CONTEXT_IMAGE_MIN_EDGE),
    photoEdge: Math.min(edge, CONTEXT_PHOTO_MAX_EDGE),
  };
};

export const resolveImageCaps = (target: ImageCapTarget = {}): ImageCaps => {
  const provider = normalize(target.provider);
  const api = normalize(target.api);
  const detailOriginal = target.detailOriginal ?? false;

  let maxEdge = SAFE_FALLBACK_MAX_EDGE;
  let maxBytes = SAFE_FALLBACK_MAX_BYTES;

  if (isAnthropicFamily(provider, api)) {
    const bytes = anthropicByteCap(detailOriginal);
    maxBytes = bytes.resize;
    if (detailOriginal) {
      maxEdge = ANTHROPIC_HARD_MAX_EDGE;
    } else {
      maxEdge = isAnthropicStandardTierModel(target.modelId ?? "")
        ? ANTHROPIC_STANDARD_MAX_EDGE
        : ANTHROPIC_HIGH_RES_MAX_EDGE;
    }
  } else if (isOpenAIFamily(provider, api)) {
    maxEdge = detailOriginal ? OPENAI_ORIGINAL_MAX_EDGE : OPENAI_MAX_EDGE;
    maxBytes = GENEROUS_RESIZE_MAX_BYTES;
  } else if (isGoogleFamily(provider, api)) {
    maxEdge = GOOGLE_MAX_EDGE;
    maxBytes = GENEROUS_RESIZE_MAX_BYTES;
  } else if (detailOriginal) {
    maxBytes = GENEROUS_RESIZE_MAX_BYTES;
  }

  const imageCount = target.imageCount ?? 0;
  if (imageCount > MANY_IMAGE_THRESHOLD) {
    maxEdge = Math.min(maxEdge, MANY_IMAGE_MAX_EDGE);
  }

  if (detailOriginal) {
    return { maxWidth: maxEdge, maxHeight: maxEdge, maxBytes, jpegQuality: DEFAULT_JPEG_QUALITY };
  }
  return { ...contextFit(maxEdge), maxBytes, jpegQuality: DEFAULT_JPEG_QUALITY };
};

export const maxInlineImageBase64Bytes = (
  _target: ImageCapTarget = {},
): number => ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES;

export const READ_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * `Read` does not know which model will see the image, so its byte ceiling
 * sits under the tightest mainstream per-image cap (Bedrock/Vertex's 5MB).
 */
export const READ_IMAGE_CAPS: ImageCaps = {
  ...contextFit(CONTEXT_IMAGE_MAX_EDGE),
  maxBytes: SAFE_FALLBACK_MAX_BYTES,
  jpegQuality: DEFAULT_JPEG_QUALITY,
};

/** Durable Object storage caps a row at 2MB, and a cloud Read result is one row. */
export const DURABLE_OBJECT_READ_IMAGE_CAPS: ImageCaps = {
  ...READ_IMAGE_CAPS,
  maxBytes: Math.floor(1.5 * 1024 * 1024),
};

/**
 * An image is billed by its pixels (~width*height/750 on Anthropic), never by
 * its base64 length, and image blocks carry no dimensions, so this is the
 * bound for the largest image Read sends.
 */
export const IMAGE_CONTEXT_TOKEN_ESTIMATE = Math.ceil(
  (READ_IMAGE_CAPS.maxWidth * READ_IMAGE_CAPS.maxHeight) / 750,
);

export const jpegQualitySteps = (startQuality: number): number[] =>
  Array.from(new Set([startQuality, 90, 80, 70, 55, 40]));

export const IMAGE_SHRINK_FACTOR = 0.75;

export const base64EncodedLength = (byteLength: number): number =>
  base64EncodedLengthOf(byteLength);

function base64EncodedLengthOf(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

export const capsForSource = (caps: ImageCaps, sourceMimeType: string): ImageCaps =>
  caps.photoEdge === undefined || triesLosslessFirst(sourceMimeType)
    ? caps
    : {
        ...caps,
        maxWidth: Math.min(caps.maxWidth, caps.photoEdge),
        maxHeight: Math.min(caps.maxHeight, caps.photoEdge),
        minEdge: Math.min(caps.minEdge ?? caps.photoEdge, caps.photoEdge),
      };

export const imageFitsCaps = (
  caps: ImageCaps,
  width: number,
  height: number,
  byteLength: number,
  sourceMimeType = "",
): boolean => {
  const fit = capsForSource(caps, sourceMimeType);
  return (
    width <= fit.maxWidth &&
    height <= fit.maxHeight &&
    base64EncodedLength(byteLength) < (fit.targetBytes ?? fit.maxBytes)
  );
};

export const fitImageDimensions = (
  caps: ImageCaps,
  width: number,
  height: number,
): { width: number; height: number } => {
  let targetWidth = width;
  let targetHeight = height;
  if (targetWidth > caps.maxWidth) {
    targetHeight = Math.max(1, Math.round((targetHeight * caps.maxWidth) / targetWidth));
    targetWidth = caps.maxWidth;
  }
  if (targetHeight > caps.maxHeight) {
    targetWidth = Math.max(1, Math.round((targetWidth * caps.maxHeight) / targetHeight));
    targetHeight = caps.maxHeight;
  }
  return { width: targetWidth, height: targetHeight };
};

export const triesLosslessFirst = (sourceMimeType: string): boolean =>
  sourceMimeType === "image/png" || sourceMimeType === "image/gif";

export type ImageEncoding =
  | { format: "image/png" }
  | { format: "image/jpeg"; quality: number };

export type ImageFitPass = {
  width: number;
  height: number;
  encodings: readonly ImageEncoding[];
  maxBytes: number;
};

const TARGET_SHRINK_FACTOR = 0.85;
const MAX_FIT_PASSES = 12;

const scaled = (size: { width: number; height: number }, factor: number) => ({
  width: Math.max(1, Math.floor(size.width * factor)),
  height: Math.max(1, Math.floor(size.height * factor)),
});

const jpeg = (quality: number): ImageEncoding => ({ format: "image/jpeg", quality });

export const imageFitPasses = (
  sourceCaps: ImageCaps,
  width: number,
  height: number,
  sourceMimeType: string,
): ImageFitPass[] => {
  const caps = capsForSource(sourceCaps, sourceMimeType);
  const graphics = triesLosslessFirst(sourceMimeType);
  const png: ImageEncoding[] = graphics ? [{ format: "image/png" }] : [];
  const fitted = fitImageDimensions(caps, width, height);
  const passes: ImageFitPass[] = [];
  const target = caps.targetBytes;
  if (target !== undefined && target < caps.maxBytes) {
    const lossy = (graphics ? [90, 85, 80] : [85, 80]).map(jpeg);
    const floor = Math.min(caps.minEdge ?? 0, Math.max(fitted.width, fitted.height));
    for (let size = fitted; Math.max(size.width, size.height) >= floor; ) {
      if (graphics) {
        passes.push({ ...size, encodings: png, maxBytes: Math.min(CONTEXT_LOSSLESS_TARGET_BYTES, caps.maxBytes) });
      }
      passes.push({ ...size, encodings: lossy, maxBytes: target });
      const next = scaled(size, TARGET_SHRINK_FACTOR);
      if (next.width === size.width && next.height === size.height) break;
      size = next;
    }
  }
  const ceiling: ImageEncoding[] =
    target !== undefined
      ? [jpeg(CONTEXT_IMAGE_MIN_JPEG_QUALITY), ...png, ...[70, 55, 40].map(jpeg)]
      : [...png, ...jpegQualitySteps(caps.jpegQuality).map(jpeg)];
  let size = fitted;
  for (let pass = 0; pass < MAX_FIT_PASSES; pass += 1) {
    passes.push({ ...size, encodings: ceiling, maxBytes: caps.maxBytes });
    const next = scaled(size, IMAGE_SHRINK_FACTOR);
    if (next.width === size.width && next.height === size.height) break;
    size = next;
  }
  return passes;
};

const formatImageBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatName = (mimeType: string): string =>
  (mimeType.split("/")[1] ?? mimeType).toUpperCase();

export const formatImageResizeNote = (resized: {
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  originalMimeType: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
}): string => {
  const scaled = resized.width !== resized.originalWidth;
  const mapping = scaled
    ? ` Multiply coordinates by ${(resized.originalWidth / resized.width).toFixed(2)} to map to the original image.`
    : "";
  return `[Image ${scaled ? "resized" : "re-encoded"} to fit the model's image limits: original ${resized.originalWidth}x${resized.originalHeight} ${formatName(resized.originalMimeType)}, ${formatImageBytes(resized.originalBytes)}; shown at ${resized.width}x${resized.height} ${formatName(resized.mimeType)}, ${formatImageBytes(resized.bytes)}.${mapping}]`;
};
