import type { OfficePreviewRef } from "@stella/contracts/office-preview";
import { isOfficePreviewRef } from "@stella/contracts/office-preview";
import {
  hasFields,
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isOneOf,
  isOptional,
  isString,
} from "@stella/contracts/value-guards";

export type DisplayFileArtifactKind =
  | "office-document"
  | "office-spreadsheet"
  | "office-slides"
  | "delimited-table";

export type DisplayPayload = {
  cloudDrivePath?: string;
} & (
  | {
      kind: "canvas-html";
      filePath: string;
      title?: string;
      slug?: string;
      createdAt: number;
      driveBacked?: boolean;
    }
  | {
      kind: "url";
      url: string;
      title: string;
      tabId: string;
      tooltip?: string;
    }
  | { kind: "office"; previewRef: OfficePreviewRef; title?: string }
  | {
      kind: "markdown";
      filePath: string;
      title?: string;
      createdAt?: number;
    }
  | {
      kind: "source-diff";
      filePath: string;
      title?: string;
      patch?: string;
      createdAt?: number;
    }
  | {
      kind: "file-artifact";
      filePath: string;
      artifactKind: DisplayFileArtifactKind;
      title?: string;
      createdAt?: number;
    }
  | { kind: "pdf"; filePath: string; title?: string }
  | {
      kind: "folder";
      filePath: string;
      title?: string;
      createdAt?: number;
    }
  | {
      kind: "trash";
      title?: string;
      createdAt?: number;
    }
  | {
      kind: "media";
      asset: MediaAsset;
      jobId?: string;
      madeBy?: string;
      prompt?: string;
      aspectRatio?: string;
      requestedSize?: { width: number; height: number };
      presentation?: "inline-image";
      imageIndex?: number;
      numImages?: number;
      toolCallId?: string;
      generationState?: "running" | "completed" | "failed" | "canceled";
      textOffset?: number;
      createdAt: number;
    }
);

export type DisplayTabPayload = DisplayPayload;

export type MediaAsset =
  | { kind: "image"; filePaths: string[] }
  | { kind: "video"; filePath: string }
  | { kind: "audio"; filePath: string }
  | { kind: "model3d"; filePath: string; label?: string }
  | { kind: "download"; filePath: string; label: string }
  | { kind: "text"; text: string };

const isHttpUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

// Media timestamps accept any number, NaN and Infinity included, as before.
const isAnyNumber = (value: unknown): boolean => typeof value === "number";
const isOptionalString = isOptional(isString);
const isOptionalNumber = isOptional(isFiniteNumber);

const MEDIA_ASSET_FIELDS: Record<MediaAsset["kind"], Record<string, (value: unknown) => boolean>> = {
  image: { filePaths: isArrayOf(isString) },
  video: { filePath: isString },
  audio: { filePath: isString },
  model3d: { filePath: isString },
  download: { filePath: isString },
  text: { text: isString },
};

const isMediaAsset = (value: unknown): boolean =>
  hasFields(value, { kind: isString }) &&
  Object.prototype.hasOwnProperty.call(MEDIA_ASSET_FIELDS, value.kind as string) &&
  hasFields(value, MEDIA_ASSET_FIELDS[value.kind as MediaAsset["kind"]]);

const MARKDOWN_LIKE_FIELDS = {
  filePath: isString,
  title: isOptionalString,
  patch: isOptionalString,
  createdAt: isOptionalNumber,
};

const DISPLAY_PAYLOAD_FIELDS: Record<
  DisplayPayload["kind"],
  Record<string, (value: unknown) => boolean>
> = {
  "canvas-html": {
    filePath: isString,
    createdAt: isFiniteNumber,
    title: isOptionalString,
    slug: isOptionalString,
    driveBacked: isOptional(isBoolean),
  },
  url: { url: isHttpUrl, title: isString, tabId: isString },
  office: { previewRef: isOfficePreviewRef },
  markdown: MARKDOWN_LIKE_FIELDS,
  "source-diff": MARKDOWN_LIKE_FIELDS,
  "file-artifact": {
    filePath: isString,
    artifactKind: isOneOf([
      "office-document",
      "office-spreadsheet",
      "office-slides",
      "delimited-table",
    ]),
    createdAt: isOptionalNumber,
  },
  pdf: { filePath: isString },
  folder: { filePath: isString, title: isOptionalString, createdAt: isOptionalNumber },
  trash: { title: isOptionalString, createdAt: isOptionalNumber },
  media: { asset: isMediaAsset, createdAt: isAnyNumber },
};

export const isDisplayPayload = (value: unknown): value is DisplayPayload =>
  hasFields(value, { kind: isString }) &&
  Object.prototype.hasOwnProperty.call(DISPLAY_PAYLOAD_FIELDS, value.kind as string) &&
  hasFields(value, DISPLAY_PAYLOAD_FIELDS[value.kind as DisplayPayload["kind"]]);

export const isDisplayTabPayload = (
  value: unknown,
): value is DisplayTabPayload => isDisplayPayload(value);

export const normalizeDisplayPayload = (
  value: unknown,
): DisplayTabPayload | null => (isDisplayTabPayload(value) ? value : null);

export const getDisplayPayloadTitle = (payload: DisplayPayload): string => {
  if (payload.kind === "canvas-html") {
    return payload.title ?? payload.filePath.split("/").pop() ?? "Canvas";
  }
  if (payload.kind === "url") return payload.title;
  if (payload.kind === "office") {
    return payload.title ?? payload.previewRef.title;
  }
  if (payload.kind === "markdown" || payload.kind === "source-diff") {
    return payload.title ?? payload.filePath.split("/").pop() ?? "File";
  }
  if (payload.kind === "file-artifact") {
    return payload.title ?? payload.filePath.split("/").pop() ?? "File";
  }
  if (payload.kind === "pdf") {
    return payload.title ?? payload.filePath.split("/").pop() ?? "Document";
  }
  if (payload.kind === "trash") {
    return payload.title ?? "Trash";
  }
  if (payload.kind === "folder") {
    return payload.title ?? payload.filePath.split(/[\\/]/).filter(Boolean).pop() ?? "Folder";
  }
  if (payload.prompt) return payload.prompt;
  if (payload.madeBy) return payload.madeBy;
  switch (payload.asset.kind) {
    case "image":
      return payload.asset.filePaths.length > 1
        ? "Generated images"
        : "Generated image";
    case "video":
      return "Generated video";
    case "audio":
      return "Generated audio";
    case "model3d":
      return payload.asset.label ?? "Generated 3D model";
    case "download":
      return payload.asset.label;
    case "text":
      return "Generated text";
  }
};
