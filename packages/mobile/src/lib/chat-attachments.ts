import type { BackendClient } from "@stella/contracts/backend/client";
import { fetch as expoFetch, type FetchRequestInit } from "expo/fetch";
import { putSignedUpload } from "@stella/contracts/request-deadline";
import {
  CHAT_ATTACHMENT_FOLDERS,
  chatAttachmentDrivePath,
  chatAttachmentFileName,
} from "@stella/contracts/chat-attachments";
import { attachmentContentType } from "./image-attachments";

export const CHAT_ATTACHMENT_MAX_COUNT = 4;

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

export const driveFileNameFor = (name: string, kind: ChatAttachmentKind) =>
  chatAttachmentFileName(name, kind === "image" ? "photo.jpg" : "file");

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
}): string =>
  chatAttachmentDrivePath({
    folder: CHAT_ATTACHMENT_FOLDERS.mobile,
    name: driveFileNameFor(args.name, args.kind),
    now: args.now,
    taken: args.taken,
    ...(args.uniquePrefix ? { prefix: args.uniquePrefix } : {}),
  });

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
