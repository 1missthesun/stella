export interface ImageCaps {
  maxWidth: number;
  maxHeight: number;
  maxBytes: number;
  jpegQuality: number;
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
export const SAFE_FALLBACK_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * Byte budget to aim for below the direct-API hard cap: staying a margin under
 * 10MB avoids an image passing the resizer only to trip the send-boundary
 * guard at exactly the wire limit.
 */
const ANTHROPIC_DIRECT_RESIZE_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);
const GENEROUS_RESIZE_MAX_BYTES = Math.floor(9.5 * 1024 * 1024);

export const DEFAULT_JPEG_QUALITY = 90;

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

  return {
    maxWidth: maxEdge,
    maxHeight: maxEdge,
    maxBytes,
    jpegQuality: DEFAULT_JPEG_QUALITY,
  };
};

export const maxInlineImageBase64Bytes = (
  _target: ImageCapTarget = {},
): number => ANTHROPIC_DIRECT_MAX_IMAGE_BASE64_BYTES;

export const READ_IMAGE_MAX_SOURCE_BYTES = 20 * 1024 * 1024;

/**
 * What `Read` fits an image to, the same on the desktop runtime, a cloud
 * agent's container, and the cloud orchestrator's Worker. `Read` does not know
 * which model will see the image (a Worker turn may route anywhere), so the
 * target fits every provider: the high-resolution Anthropic long edge (also
 * under Gemini's 3072) and the safe byte budget under the tightest mainstream
 * per-image cap (Bedrock/Vertex's 5MB). The send step still applies the
 * provider-aware caps above where it knows the model (e.g. OpenAI's 2048).
 */
export const READ_IMAGE_CAPS: ImageCaps = {
  maxWidth: ANTHROPIC_HIGH_RES_MAX_EDGE,
  maxHeight: ANTHROPIC_HIGH_RES_MAX_EDGE,
  maxBytes: SAFE_FALLBACK_MAX_BYTES,
  jpegQuality: DEFAULT_JPEG_QUALITY,
};

/**
 * The same target where the result is stored as one Durable Object SQLite
 * row: the cloud orchestrator's Read runs in a Worker, and its result is a
 * single pi entry (and journal row), which the platform caps at 2MB. The edge,
 * ladder and note are unchanged; only the byte budget leaves room for the row
 * (a 2576px photo at q90 is ~1.1MB, so most photos are unaffected).
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
  Math.ceil(byteLength / 3) * 4;

export const imageFitsCaps = (
  caps: ImageCaps,
  width: number,
  height: number,
  byteLength: number,
): boolean =>
  width <= caps.maxWidth &&
  height <= caps.maxHeight &&
  base64EncodedLength(byteLength) < caps.maxBytes;

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
