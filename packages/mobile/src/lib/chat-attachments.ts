import type { BackendClient } from "@stella/contracts/backend/client";
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
};

export type AttachmentStatus =
  | { status: "uploading" }
  | { status: "ready"; drivePath: string }
  | { status: "failed"; message: string };

export type ComposerAttachment = PickedAttachment & AttachmentStatus;

export type ReadyAttachment = PickedAttachment & {
  status: "ready";
  drivePath: string;
};

export const withAttachmentStatus = (
  attachments: readonly ComposerAttachment[],
  id: string,
  status: AttachmentStatus,
): ComposerAttachment[] =>
  attachments.map((entry) =>
    entry.id === id ? { ...entry, ...status } : entry,
  );

export const isAttachmentReady = (
  attachment: ComposerAttachment,
): attachment is ReadyAttachment => attachment.status === "ready";

export const attachmentsSettled = (
  attachments: readonly ComposerAttachment[],
): attachments is readonly ReadyAttachment[] =>
  attachments.every(isAttachmentReady);

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

export const driveAttachmentPath = (args: {
  name: string;
  kind: ChatAttachmentKind;
  now: Date;
  taken: ReadonlySet<string>;
}): string => {
  const day = args.now.toISOString().slice(0, 10);
  const fileName = driveFileNameFor(args.name, args.kind);
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

export type AttachmentUploadDeps = {
  client: Pick<BackendClient, "call">;
  readFile: (uri: string) => Promise<Uint8Array<ArrayBuffer>>;
  fetch?: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>;
  now?: () => Date;
};

export const uploadChatAttachment = async (
  attachment: PickedAttachment,
  taken: ReadonlySet<string>,
  deps: AttachmentUploadDeps,
): Promise<string> => {
  const path = driveAttachmentPath({
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
  const put = await (deps.fetch ?? fetch)(prepared.uploadUrl, {
    method: "PUT",
    headers: { "content-type": prepared.contentType },
    body: bytes,
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
