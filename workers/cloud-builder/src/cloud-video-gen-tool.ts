import type { TSchema } from "@sinclair/typebox";
import { generatedImageFileName } from "@stella/contracts/generated-image-name";
import { stellaVideoRequest } from "@stella/contracts/media-models";
import type { MediaJob } from "@stella/contracts/backend/media";
import {
  asNonEmptyString,
  type CloudMediaArtifact,
  type CloudMediaFailure,
  type CloudMediaToolContext,
  downloadArtifact,
  generatedDrivePath,
  runCloudMediaJob,
  saveGeneratedFiles,
  savedFilesText,
} from "./cloud-media-job.js";
import type { ReplayableAgentTool } from "./tool-replay.js";

export const CLOUD_VIDEO_GEN_TOOL_NAME = "video_gen";

const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const INLINE_LIMIT_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const JOB_TIMEOUT_MS = 12 * 60_000;
const DRIVE_OUTPUT_PREFIX = "videos";
const REFERENCE_SIGNING_BUCKET_MS = 60 * 60_000;
const DEFAULT_SECONDS = 5;
const MIN_SECONDS = 4;
const MAX_SECONDS = 15;
const NOUN = "Video";
const HTTP_URL_RE = /^https?:\/\//i;
const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;
const RESOLUTIONS = ["480p", "720p", "1080p"] as const;

export type CloudVideoGenDetails =
  | {
      status: "succeeded";
      jobId: string;
      model: string;
      prompt: string;
      durationSeconds: number;
      resolution: string;
      drivePaths: string[];
      artifacts: CloudMediaArtifact[];
      reattached: boolean;
      completedAt?: number;
    }
  | CloudMediaFailure;

const ORCHESTRATOR_DESCRIPTION =
  "Generate a short video clip (with sound) with Stella's managed video model, from a text prompt or by animating a start image. Takes one to a few minutes; the call stays pending until the job settles. On success the video is saved into the user's drive and shown in the chat, and the result lists its drive path; don't link or describe the path unless asked. Never retry or parallel-submit a pending call. Video bills per second, so keep durationSeconds to what was asked (default 5). Required: prompt.";

const AGENT_DESCRIPTION =
  "Generate a short video clip (with sound) with Stella's managed video model (billed to the user's plan), from a text prompt or by animating a start image. Takes one to a few minutes; the call stays pending until the job settles. On success the video is saved into the user's drive and attached to your report automatically, and the result lists its drive path and a short-lived download URL in case your shell needs the bytes. Never retry or parallel-submit a pending call. Video bills per second, so keep durationSeconds to what was asked (default 5). Use this instead of hand-building animations or calling video providers directly. Required: prompt.";

const PARAMETERS = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description:
        "What happens in the clip: subject, action, camera movement, style, lighting, and any sound or dialogue. With a start image, describe the motion.",
    },
    durationSeconds: {
      type: "integer",
      minimum: MIN_SECONDS,
      maximum: MAX_SECONDS,
      description: `Length in seconds, ${MIN_SECONDS}–${MAX_SECONDS}. Defaults to ${DEFAULT_SECONDS}.`,
    },
    aspectRatio: {
      type: "string",
      enum: [...ASPECT_RATIOS],
      description: "Aspect ratio for a text-to-video clip. Defaults to 16:9. Ignored with a start image, which sets it.",
    },
    resolution: {
      type: "string",
      enum: [...RESOLUTIONS],
      description: "Defaults to 720p. 1080p costs over twice as much; use it only when asked.",
    },
    generateAudio: {
      type: "boolean",
      description: "Whether the clip has generated sound. Defaults to true; same price either way.",
    },
    startImageDrivePath: {
      type: "string",
      description:
        "Optional drive path of an image to animate as the first frame (an attachment in the user's message, or an image generated earlier).",
    },
    startImageUrl: {
      type: "string",
      description: "Optional public http(s) URL of an image to animate as the first frame.",
    },
    endImageDrivePath: {
      type: "string",
      description: "Optional drive path of an image for the last frame; needs a start image.",
    },
  },
  required: ["prompt"],
} as const;

type Args = {
  prompt?: unknown;
  durationSeconds?: unknown;
  duration?: unknown;
  aspectRatio?: unknown;
  aspect_ratio?: unknown;
  resolution?: unknown;
  generateAudio?: unknown;
  startImageDrivePath?: unknown;
  startImageUrl?: unknown;
  endImageDrivePath?: unknown;
};

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], name: string): T | null => {
  if (!value) return null;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`video_gen ${name} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
};

const parseSeconds = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return DEFAULT_SECONDS;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds)) throw new Error("video_gen durationSeconds must be a number.");
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds)));
};

const drivePathArg = (value: unknown): string | null => {
  const path = asNonEmptyString(value);
  return path ? path.replace(/^\/?(?:workspace\/world\/)?drive\//, "") : null;
};

const extractVideoUrl = (output: unknown): string | null => {
  if (!output || typeof output !== "object") return null;
  const video = (output as Record<string, unknown>).video;
  if (typeof video === "string") return asNonEmptyString(video);
  if (!video || typeof video !== "object") return null;
  return asNonEmptyString((video as Record<string, unknown>).url);
};

const sniffVideo = (bytes: Uint8Array): { mimeType: string; extension: string } | null => {
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    return brand === "qt  " ? { mimeType: "video/quicktime", extension: "mov" } : { mimeType: "video/mp4", extension: "mp4" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { mimeType: "video/webm", extension: "webm" };
  }
  return null;
};

const statusText = (status: MediaJob["status"]): string =>
  status === "queued"
    ? "Video generation is queued…"
    : status === "running"
      ? "Generating video (this takes a minute or more)…"
      : status === "succeeded"
        ? "Saving generated video…"
        : "Video generation finished.";

export const createCloudVideoGenTool = (context: CloudMediaToolContext): ReplayableAgentTool => ({
  name: CLOUD_VIDEO_GEN_TOOL_NAME,
  replay: "keyed",
  label: "Generate video",
  workingText: "Generating video",
  description: context.downloadLinks ? AGENT_DESCRIPTION : ORCHESTRATOR_DESCRIPTION,
  parameters: PARAMETERS as unknown as TSchema,
  execute: async (toolCallId, params, signal, onUpdate) => {
    const args = params as Args;
    const prompt = asNonEmptyString(args.prompt);
    if (!prompt) throw new Error("prompt is required.");
    const durationSeconds = parseSeconds(args.durationSeconds ?? args.duration);
    const aspectRatio = oneOf(
      asNonEmptyString(args.aspectRatio) ?? asNonEmptyString(args.aspect_ratio),
      ASPECT_RATIOS,
      "aspectRatio",
    );
    const resolution = oneOf(asNonEmptyString(args.resolution), RESOLUTIONS, "resolution") ?? "720p";
    const generateAudio = typeof args.generateAudio === "boolean" ? args.generateAudio : true;
    const startUrl = asNonEmptyString(args.startImageUrl);
    if (startUrl && !HTTP_URL_RE.test(startUrl)) {
      throw new Error("startImageUrl must be an http(s) URL; use startImageDrivePath for the user's own files.");
    }
    const startPath = drivePathArg(args.startImageDrivePath);
    const endPath = drivePathArg(args.endImageDrivePath);
    if (startUrl && startPath) throw new Error("Give either startImageUrl or startImageDrivePath, not both.");
    if (endPath && !startUrl && !startPath) throw new Error("endImageDrivePath needs a start image.");

    const now = context.now ?? Date.now;
    const drivePaths = [startPath, endPath].filter((path): path is string => Boolean(path));
    const signed =
      drivePaths.length > 0
        ? (
            (await context.ownerInternal("drive.signImages", {
              paths: drivePaths,
              signedAt: Math.floor(now() / REFERENCE_SIGNING_BUCKET_MS) * REFERENCE_SIGNING_BUCKET_MS,
            })) as { urls: string[] }
          ).urls
        : [];
    const imageUrl = startUrl ?? (startPath ? signed[0] : null) ?? null;
    const endImageUrl = endPath ? (signed[startPath ? 1 : 0] ?? null) : null;
    const request = stellaVideoRequest({
      prompt,
      durationSeconds,
      resolution,
      aspectRatio,
      generateAudio,
      imageUrl,
      endImageUrl,
    });
    const fetchImpl = context.fetchImpl ?? fetch;

    return await runCloudMediaJob({
      context: { ...context, timeoutMs: context.timeoutMs ?? JOB_TIMEOUT_MS },
      noun: NOUN,
      keyPrefix: "stella-video-gen-v1-",
      keyNamespace: "stella-cloud-video-gen-v1",
      toolCallId,
      prompt,
      request,
      ...(signal ? { signal } : {}),
      ...(onUpdate ? { onUpdate } : {}),
      statusText,
      hasOutputs: (output) => extractVideoUrl(output) !== null,
      materialize: async (job, reattached) => {
        const url = extractVideoUrl(job.output)!;
        const bytes = await downloadArtifact({
          fetchImpl,
          url,
          maxBytes: MAX_VIDEO_BYTES,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          noun: NOUN,
          ...(signal ? { signal } : {}),
        });
        const sniffed = sniffVideo(bytes);
        if (!sniffed) throw new Error("Video artifact was partial or had an unsupported format.");
        const saved = await saveGeneratedFiles({
          context,
          source: CLOUD_VIDEO_GEN_TOOL_NAME,
          toolCallId,
          kind: "video",
          files: [
            {
              path: generatedDrivePath(DRIVE_OUTPUT_PREFIX, job.jobId, 0, sniffed.extension, now()),
              name: generatedImageFileName({ prompt, index: 0, count: 1, extension: sniffed.extension }),
              contentType: sniffed.mimeType,
              bytes,
            },
          ],
          inlineLimitBytes: INLINE_LIMIT_BYTES,
          noun: NOUN,
          ...(signal ? { signal } : {}),
        });
        const details: CloudVideoGenDetails = {
          status: "succeeded",
          jobId: job.jobId,
          model: job.model,
          prompt,
          durationSeconds,
          resolution,
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
