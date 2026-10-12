/**
 * `image_gen` for the cloud orchestrator and its agents.
 *
 * Desktop's tool (`packages/runtime/kernel/tools/media.ts`) drives the managed
 * media API and materializes the result under ~/.stella/media/outputs. There
 * is no local disk here, so this one runs the job through the owner's object
 * (`cloud-media-job.ts`) and lands the finished image in the owner's drive.
 * The drive file is what both chat clients render and what the user keeps;
 * the tool result also carries the media job id so the desktop can
 * materialize its own copy the way it does for every media job.
 *
 * BYOK does not exist here: provider keys live on the user's device, so every
 * cloud generation is Stella managed and metered like any other managed job.
 */

import type { TSchema } from "@sinclair/typebox";
import { generatedImageFileName } from "@stella/contracts/generated-image-name";
import { stellaImageRequest } from "@stella/contracts/media-models";
import type { MediaJob } from "@stella/contracts/backend/media";
import {
  asNonEmptyString,
  type CloudMediaArtifact,
  type CloudMediaDriveFile,
  type CloudMediaFailure,
  type CloudMediaToolContext,
  downloadArtifact,
  generatedDrivePath,
  runCloudMediaJob,
  saveGeneratedFiles,
  savedFilesText,
  throwIfAborted,
} from "./cloud-media-job.js";
import type { ReplayableAgentTool } from "./tool-replay.js";

export const CLOUD_IMAGE_GEN_TOOL_NAME = "image_gen";

const MAX_REFERENCE_ITEMS = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DRIVE_OUTPUT_PREFIX = "images";
const REFERENCE_SIGNING_BUCKET_MS = 60 * 60_000;
const NOUN = "Image";

const HTTP_URL_RE = /^https?:\/\//i;

export type CloudImageGenDriveFile = CloudMediaDriveFile;
export type CloudImageGenToolContext = CloudMediaToolContext;
export type CloudImageGenArtifact = CloudMediaArtifact;

type CloudImageGenArgs = {
  prompt?: unknown;
  aspectRatio?: unknown;
  aspect_ratio?: unknown;
  size?: unknown;
  quality?: unknown;
  referenceImageUrls?: unknown;
  referenceDrivePaths?: unknown;
};

type RemoteImage = { url: string; mimeType?: string };

export type CloudImageGenDetails =
  | {
      status: "succeeded";
      jobId: string;
      model: string;
      prompt: string;
      aspectRatio?: string;
      requestedSize?: { width: number; height: number };
      drivePaths: string[];
      artifacts: CloudImageGenArtifact[];
      reattached: boolean;
      completedAt?: number;
    }
  | CloudMediaFailure;

export const CLOUD_IMAGE_GEN_TOOL_DESCRIPTION =
  "Generate a still image with Stella's managed image provider. The call stays pending until the job settles: on success the image is saved into the user's drive and shown in the chat, and the result lists its drive path(s); don't link or describe a path unless asked. Never retry or parallel-submit a pending call; Stella reattaches to the same job on a lost response. Do not poll, download, or open the result yourself. Required: prompt.";

const CLOUD_AGENT_IMAGE_GEN_TOOL_DESCRIPTION =
  "Generate a still image with Stella's managed image provider (billed to the user's plan). The call stays pending until the job settles: on success the image is saved into the user's drive and attached to your report automatically, and the result lists its drive path and a short-lived download URL in case your shell needs the bytes. Never retry or parallel-submit a pending call. Use this instead of drawing images by hand or calling image providers directly. Required: prompt.";

export const CLOUD_IMAGE_GEN_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description:
        "Description of the image to generate. Be specific about subject, style, framing, color, lighting, and any text overlays.",
    },
    aspectRatio: {
      type: "string",
      description:
        "Optional aspect ratio (e.g. '1:1', '16:9', '9:16', '4:3'). Defaults to the model's choice.",
    },
    size: {
      type: "object",
      description:
        "Optional explicit pixel dimensions. Only set this when the default aspectRatio presets won't do. Subject to the model envelope: max edge ≤ 3840, 655,360 ≤ width × height ≤ 8,294,400, longest edge ≤ 3× shortest edge.",
      properties: {
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
      },
      required: ["width", "height"],
    },
    quality: {
      type: "string",
      enum: ["low", "medium", "high", "xhigh", "max"],
      description:
        "Optional quality. Defaults to 'low'; use a higher one only when the user explicitly asks for more fidelity.",
    },
    referenceImageUrls: {
      type: "array",
      items: { type: "string" },
      maxItems: MAX_REFERENCE_ITEMS,
      description:
        "Optional public http(s) image URLs to use as reference inputs. At most four references in total across URLs and drive paths. When any reference is provided the image is an edit of them.",
    },
    referenceDrivePaths: {
      type: "array",
      items: { type: "string" },
      maxItems: MAX_REFERENCE_ITEMS,
      description:
        "Optional paths of image files in the user's drive to use as reference inputs — the paths listed under 'Attached in my drive' in the user's message, or files a previous turn produced. Only use images the user asked you to work from.",
    },
  },
  required: ["prompt"],
} as const;

const collectStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const trimmed = asNonEmptyString(entry);
    if (trimmed) out.push(trimmed);
  }
  return out;
};

const validateSize = (value: unknown): { width: number; height: number } | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as { width?: unknown; height?: unknown };
  const width = typeof record.width === "number" ? Math.floor(record.width) : NaN;
  const height = typeof record.height === "number" ? Math.floor(record.height) : NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("image_gen size requires positive integer width and height.");
  }
  const maxEdge = Math.max(width, height);
  const minEdge = Math.min(width, height);
  const pixelArea = width * height;
  if (maxEdge > 3840) {
    throw new Error(`image_gen size max edge ${maxEdge} exceeds 3840.`);
  }
  if (pixelArea < 655_360 || pixelArea > 8_294_400) {
    throw new Error(`image_gen size pixel area ${pixelArea} is outside 655,360–8,294,400.`);
  }
  if (maxEdge > minEdge * 3) {
    throw new Error(`image_gen size aspect ratio ${maxEdge}:${minEdge} is steeper than 3:1.`);
  }
  return { width, height };
};

const extractRemoteImages = (output: unknown): RemoteImage[] => {
  if (!output || typeof output !== "object") return [];
  const images = (output as Record<string, unknown>).images;
  if (!Array.isArray(images)) return [];
  return images
    .map((entry): RemoteImage | null => {
      if (typeof entry === "string") return { url: entry };
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const url = asNonEmptyString(record.url);
      if (!url) return null;
      const mimeType = asNonEmptyString(record.mimeType) ?? asNonEmptyString(record.content_type) ?? undefined;
      return { url, ...(mimeType ? { mimeType } : {}) };
    })
    .filter((entry): entry is RemoteImage => entry !== null);
};

const sniffImageMimeType = (bytes: Uint8Array): string | null => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  return null;
};

const extensionForMime = (mimeType: string): string => {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
};

const statusText = (status: MediaJob["status"]): string =>
  status === "queued"
    ? "Image generation is queued…"
    : status === "running"
      ? "Generating image…"
      : status === "succeeded"
        ? "Saving generated image…"
        : "Image generation finished.";

export const createCloudImageGenTool = (
  context: CloudImageGenToolContext,
): ReplayableAgentTool => ({
  name: CLOUD_IMAGE_GEN_TOOL_NAME,
  replay: "keyed",
  label: "Generate image",
  workingText: "Generating image",
  description: context.downloadLinks ? CLOUD_AGENT_IMAGE_GEN_TOOL_DESCRIPTION : CLOUD_IMAGE_GEN_TOOL_DESCRIPTION,
  parameters: CLOUD_IMAGE_GEN_TOOL_PARAMETERS as unknown as TSchema,
  execute: async (toolCallId, params, signal, onUpdate) => {
    const args = params as CloudImageGenArgs;
    const prompt = asNonEmptyString(args.prompt);
    if (!prompt) throw new Error("prompt is required.");

    const requestedSize = validateSize(args.size);
    const aspectRatio = asNonEmptyString(args.aspectRatio) ?? asNonEmptyString(args.aspect_ratio);
    const quality = asNonEmptyString(args.quality);
    const referenceUrls = collectStringList(args.referenceImageUrls);
    const referenceDrivePaths = collectStringList(args.referenceDrivePaths);
    if (referenceUrls.length + referenceDrivePaths.length > MAX_REFERENCE_ITEMS) {
      throw new Error(`image_gen accepts at most ${MAX_REFERENCE_ITEMS} reference images.`);
    }
    for (const url of referenceUrls) {
      if (!HTTP_URL_RE.test(url)) {
        throw new Error(
          `referenceImageUrls entry is not an http(s) URL: ${url}. Use referenceDrivePaths for the user's own files.`,
        );
      }
    }

    const now = context.now ?? Date.now;
    const driveReferenceUrls =
      referenceDrivePaths.length > 0
        ? (
            (await context.ownerInternal("drive.signImages", {
              paths: referenceDrivePaths.map((path) => path.replace(/^\/?(?:workspace\/world\/)?drive\//, "")),
              signedAt: Math.floor(now() / REFERENCE_SIGNING_BUCKET_MS) * REFERENCE_SIGNING_BUCKET_MS,
            })) as { urls: string[] }
          ).urls
        : [];
    const imageUrls = [...referenceUrls, ...driveReferenceUrls];
    const request = stellaImageRequest({ prompt, aspectRatio, size: requestedSize, quality, imageUrls });
    const fetchImpl = context.fetchImpl ?? fetch;

    return await runCloudMediaJob({
      context,
      noun: NOUN,
      keyPrefix: "stella-image-gen-v1-",
      keyNamespace: "stella-cloud-image-gen-v1",
      toolCallId,
      prompt,
      request,
      ...(signal ? { signal } : {}),
      ...(onUpdate ? { onUpdate } : {}),
      statusText,
      hasOutputs: (output) => extractRemoteImages(output).length > 0,
      materialize: async (job, reattached) => {
        const images = extractRemoteImages(job.output);
        const files: Array<{ path: string; name: string; contentType: string; bytes: Uint8Array }> = [];
        for (const [index, image] of images.entries()) {
          throwIfAborted(signal, NOUN);
          const bytes = await downloadArtifact({
            fetchImpl,
            url: image.url,
            maxBytes: MAX_IMAGE_BYTES,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
            noun: NOUN,
            ...(signal ? { signal } : {}),
          });
          const mimeType = sniffImageMimeType(bytes);
          if (!mimeType) throw new Error("Image artifact was partial or had an unsupported MIME type.");
          const extension = extensionForMime(mimeType);
          files.push({
            path: generatedDrivePath(DRIVE_OUTPUT_PREFIX, job.jobId, index, extension, now()),
            name: generatedImageFileName({ prompt, index, count: images.length, extension }),
            contentType: mimeType,
            bytes,
          });
        }
        const saved = await saveGeneratedFiles({
          context,
          source: CLOUD_IMAGE_GEN_TOOL_NAME,
          toolCallId,
          kind: "image",
          files,
          inlineLimitBytes: MAX_IMAGE_BYTES,
          noun: NOUN,
          ...(signal ? { signal } : {}),
        });
        const details: CloudImageGenDetails = {
          status: "succeeded",
          jobId: job.jobId,
          model: job.model,
          prompt,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(requestedSize ? { requestedSize } : {}),
          drivePaths: saved.artifacts.map((artifact) => artifact.path),
          artifacts: saved.artifacts,
          reattached,
          ...(typeof job.completedAt === "number" ? { completedAt: job.completedAt } : {}),
        };
        return {
          content: [{ type: "text", text: savedFilesText(NOUN, saved, Boolean(context.downloadLinks)) }],
          details,
        };
      },
    });
  },
});
