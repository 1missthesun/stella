import {
  evidenceSourceKind,
  type EvidenceSourceKind,
} from "./chat-evidence-naming.js";
import { driveLinkPath, driveLinkTarget } from "./cloud-world-paths.js";
import { isHtmlPagePath } from "./page-preview.js";

export type ReplyAttachmentPlacement = "media" | "pill";

const REPLY_MEDIA_KINDS: ReadonlySet<EvidenceSourceKind> = new Set([
  "image",
  "video",
  "audio",
]);

export const isReplyMediaKind = (kind: EvidenceSourceKind): boolean =>
  REPLY_MEDIA_KINDS.has(kind);

export const isReplyMediaSource = (
  filePath: string,
  kind: EvidenceSourceKind = evidenceSourceKind(filePath, false),
): boolean =>
  isReplyMediaKind(kind) || (kind === "page" && isHtmlPagePath(filePath));

export const replyAttachmentPlacement = (
  filePath: string,
): ReplyAttachmentPlacement => (isReplyMediaSource(filePath) ? "media" : "pill");

export const replyAttachmentTarget = (
  filePath: string,
  options: { driveRelative?: boolean } = {},
): string => {
  const trimmed = filePath.trim();
  const drivePath =
    driveLinkPath(trimmed) ?? (options.driveRelative ? trimmed : null);
  return drivePath ? driveLinkTarget(drivePath) : trimmed;
};
