export interface ImageCaps {
  maxWidth: number;
  maxHeight: number;
  /** The hard base64 ceiling; never exceeded. */
  maxBytes: number;
  jpegQuality: number;
  /**
   * The base64 size an image is fitted to when it can be without losing
   * detail: at good JPEG quality and at least `minEdge` on its long side.
   * When it can't, the image keeps that resolution and quality and only has
   * to fit `maxBytes`.
   */
  targetBytes?: number;
  minEdge?: number;
  /** A tighter long edge for photos; screenshots and graphics keep `maxWidth`/`maxHeight` for their text. */
  photoEdge?: number;
}

export interface ImageCapTarget {
  provider?: string;
  api?: string;
  modelId?: string;
  imageCount?: number;
  detailOriginal?: boolean;
}

/**
 * Anthropic's documented per-image base64 ceiling on the direct API (and
 * claude.ai). This is the true hard cap the wire rejects above; it replaces
 * the previously-divergent 4.5MB/5MB/10MB constants scattered across the
 * resize, send-boundary, and spill modules.
 */
export const ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;

export const ANTHROPIC_HIGH_RES_MAX_EDGE = 2576;
export const ANTHROPIC_STANDARD_MAX_EDGE = 1568;
export const ANTHROPIC_HARD_MAX_EDGE = 8000;

export const OPENAI_MAX_EDGE = 2048;
export const OPENAI_ORIGINAL_MAX_EDGE = 6000;

export const GOOGLE_MAX_EDGE = 3072;

// --- Many-image request rule (Anthropic: >20 blocks => each <=2000px) ---

export const MANY_IMAGE_THRESHOLD = 20;
export const MANY_IMAGE_MAX_EDGE = 2000;

export const SAFE_FALLBACK_MAX_EDGE = 2048;

/**
 * What an image is fitted to when it enters a conversation. Every image is
 * resent with each later request, so it is fitted once, to what models use
 * and to ~1 MB, which keeps a long chat's images within the providers'
 * request limits. Screenshots and graphics keep the high-resolution Anthropic
 * edge (2576px): small text in a retina screenshot stops being readable at
 * 2000px even as lossless PNG, and as JPEG at quality 90 it still fits ~1 MB.
 * Photos gain nothing past 2000px (OpenAI fits images into 2048px, Anthropic's
 * standard models into 1568px).
 */
export const CONTEXT_IMAGE_MAX_EDGE = 2576;
export const CONTEXT_PHOTO_MAX_EDGE = 2000;
export const CONTEXT_IMAGE_MIN_EDGE = 1568;
/**
 * Screenshots and graphics may go a little past ~1 MB to stay lossless PNG:
 * dense small text that JPEG at quality 90-95 misreads (a "YJ" read as "JY")
 * reads correctly from the same pixels as PNG. (Lossless WebP doesn't help:
 * the same pixels as WebP were misread the same way, so the route re-encodes
 * WebP before the model sees it.)
 */
export const CONTEXT_LOSSLESS_TARGET_BYTES = base64EncodedLengthOf(1.5 * 1024 * 1024);
export const CONTEXT_IMAGE_TARGET_BYTES = base64EncodedLengthOf(1024 * 1024);
export const SAFE_FALLBACK_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * Byte budget to aim for below the direct-API hard cap: staying a margin under
 * 10MB avoids an image passing the resizer only to trip the send-boundary
 * guard at exactly the wire limit.
 */
const ANTHROPIC_DIRECT_RESIZE_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);
const GENEROUS_RESIZE_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);

export const DEFAULT_JPEG_QUALITY = 90;

/** Lowest JPEG quality an image is encoded at to meet `targetBytes`. */
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
 * What `Read` fits an image to, the same on the desktop runtime, a cloud
 * agent's container, and the cloud orchestrator's Worker. `Read` does not know
 * which model will see the image (a Worker turn may route anywhere), so the
 * target is the conversation fit above, with the safe byte ceiling under the
 * tightest mainstream per-image cap (Bedrock/Vertex's 5MB) for images that
 * can't reach ~1 MB without losing detail.
 */
export const READ_IMAGE_CAPS: ImageCaps = {
  ...contextFit(CONTEXT_IMAGE_MAX_EDGE),
  maxBytes: SAFE_FALLBACK_MAX_BYTES,
  jpegQuality: DEFAULT_JPEG_QUALITY,
};

/**
 * The same target where the result is stored as one Durable Object SQLite
 * row: the cloud orchestrator's Read runs in a Worker, and its result is a
 * single pi entry (and journal row), which the platform caps at 2MB. The edge,
 * ladder and note are unchanged; only the byte ceiling leaves room for the row.
 */
export const DURABLE_OBJECT_READ_IMAGE_CAPS: ImageCaps = {
  ...READ_IMAGE_CAPS,
  maxBytes: Math.floor(1.5 * 1024 * 1024),
};

/**
 * Context tokens one image block costs, for budgeting a history window. An
 * image is billed by its pixels (~width*height/750 on Anthropic), never by
 * its base64 length; counting the base64 as text made one photo read as
 * ~375k tokens and pushed the whole conversation out of the window. Image
 * blocks carry no dimensions, so this is the bound for the largest image
 * Read sends (a square at the Read long edge).
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

/** The caps for an image of `sourceMimeType`: photos take `photoEdge`. */
export const capsForSource = (caps: ImageCaps, sourceMimeType: string): ImageCaps =>
  caps.photoEdge === undefined || triesLosslessFirst(sourceMimeType)
    ? caps
    : {
        ...caps,
        maxWidth: Math.min(caps.maxWidth, caps.photoEdge),
        maxHeight: Math.min(caps.maxHeight, caps.photoEdge),
        minEdge: Math.min(caps.minEdge ?? caps.photoEdge, caps.photoEdge),
      };

/** Whether an image goes as it is: within the edge and the size it would be fitted to. */
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

/**
 * How an image that doesn't go as it is gets fitted, in order: each pass
 * resizes to its dimensions and takes the first encoding under its byte
 * limit. With a `targetBytes`, the first passes aim for it at good quality,
 * never below `minEdge`: screenshots and graphics first as PNG (within
 * `CONTEXT_LOSSLESS_TARGET_BYTES`), then as JPEG at 90-80; photos as JPEG at
 * 85-80. Past those, the image keeps its full fitted size and only has to fit
 * `maxBytes`, lowering quality and then size only as far as that needs. The
 * runtime's Photon resize and the Worker's Images binding both follow this
 * plan.
 */
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
