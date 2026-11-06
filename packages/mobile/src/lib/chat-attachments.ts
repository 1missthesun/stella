import type { BackendClient } from "@stella/contracts/backend/client";
import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";
import { putSignedUpload } from "@stella/contracts/request-deadline";
import { attachmentContentType } from "./image-attachments";

export const CHAT_ATTACHMENT_MAX_COUNT = 4;

const CHAT_ATTACHMENT_DRIVE_PREFIX = "uploads";

const MAX_SEGMENT_LENGTH = 255;

export type ChatAttachmentKind = "image" | "file";

export type PickedAttachment = {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: ChatAttachmentKind;
  video?: true;
  posterUri?: string;
};

export type ComposerAttachment = PickedAttachment & {
  drivePath: string;
  failed?: { message: string };
};

/** The local image a tile shows: the photo itself, or a video's poster frame. */
export const attachmentPreviewUri = (
  attachment: Pick<PickedAttachment, "kind" | "uri" | "posterUri">,
): string | undefined =>
  attachment.kind === "image" ? attachment.uri : attachment.posterUri;

export const appendAttachments = <T>(
  current: readonly T[],
  incoming: readonly T[],
  limit = CHAT_ATTACHMENT_MAX_COUNT,
): { attachments: T[]; rejected: number } => {
  const combined = [...current, ...incoming];
  return {
    attachments: combined.slice(0, limit),
    rejected: Math.max(0, combined.length - limit),
  };
};

export const driveFileNameFor = (name: string, kind: ChatAttachmentKind) => {
  const cleaned = name
    .replaceAll("\\", "/")
    .split("/")
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return kind === "image" ? "photo.jpg" : "file";
  }
  return cleaned.slice(-MAX_SEGMENT_LENGTH);
};

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/quicktime": ".mov",
  "video/mp4": ".mp4",
  "video/x-m4v": ".m4v",
};

/** Picker names can lack an extension (videos especially); the agent needs one to know the type. */
export const withMimeExtension = (name: string, mimeType: string): string => {
  if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
  return `${name}${EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] ?? ""}`;
};

export const driveAttachmentPath = (args: {
  name: string;
  kind: ChatAttachmentKind;
  now: Date;
  taken: ReadonlySet<string>;
  uniquePrefix?: string;
}): string => {
  const day = args.now.toISOString().slice(0, 10);
  const fileName = `${args.uniquePrefix ? `${args.uniquePrefix}-` : ""}${driveFileNameFor(args.name, args.kind)}`.slice(-MAX_SEGMENT_LENGTH);
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${CHAT_ATTACHMENT_DRIVE_PREFIX}/${day}/${
      attempt === 1 ? fileName : `${stem}-${attempt}${extension}`
    }`;
    if (!args.taken.has(candidate)) return candidate;
  }
};

export const withAttachmentPreamble = (
  prompt: string,
  paths: readonly string[],
): string => {
  if (!paths.length) return prompt;
  const lines = paths.map((path) => `- ${path}`).join("\n");
  return `${prompt}\n\nAttached in my drive:\n${lines}`;
};

const ATTACHMENT_PREAMBLE = /(?:^|\n\n)Attached in my drive:\n((?:- [^\n]+(?:\n|$))+)$/;

/** Splits the Drive file list that `withAttachmentPreamble` appended off a prompt. */
export const splitAttachmentPreamble = (
  text: string,
): { text: string; paths: string[] } => {
  const match = ATTACHMENT_PREAMBLE.exec(text);
  if (!match) return { text, paths: [] };
  const paths = match[1]!
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((path) => path.length > 0 && path.length <= 400);
  return { text: text.slice(0, match.index), paths };
};

export type AttachmentUploadDeps = {
  client: Pick<BackendClient, "call">;
  readFile: (uri: string) => Promise<Uint8Array<ArrayBuffer>>;
  now?: () => Date;
  path?: string;
};

const uploadFetch = async (url: string, init: RequestInit): Promise<Response> =>
  (await expoFetch(url, init as FetchRequestInit)) as unknown as Response;

export const uploadChatAttachment = async (
  attachment: PickedAttachment,
  taken: ReadonlySet<string>,
  deps: AttachmentUploadDeps,
): Promise<string> => {
  const path = deps.path ?? driveAttachmentPath({
    name: attachment.name,
    kind: attachment.kind,
    now: deps.now?.() ?? new Date(),
    taken,
  });
  const bytes = await deps.readFile(attachment.uri);
  const contentType = attachmentContentType(bytes, attachment.mimeType);
  const prepared = await deps.client.call("drive.prepareUpload", {
    path,
    sizeBytes: bytes.byteLength,
    contentType,
  });
  const put = await putSignedUpload({
    url: prepared.uploadUrl,
    body: bytes,
    contentType: prepared.contentType,
    label: `Uploading ${attachment.name || "your attachment"}`,
    fetchImpl: uploadFetch,
  });
  if (!put.ok) {
    throw new Error(`Upload failed (${put.status}).`);
  }
  const finalized = await deps.client.call("drive.finalizeUpload", {
    path: prepared.path,
    uploadId: prepared.uploadId,
    contentType,
    source: "mobile-chat",
  });
  return finalized.path;
};
