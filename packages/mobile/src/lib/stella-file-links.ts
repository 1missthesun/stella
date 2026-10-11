import { parseFileLinkTarget } from "@stella/contracts/local-file-links";
import {
  cloudWorldDriveName,
  driveLinkPath,
} from "@stella/contracts/cloud-world-paths";
import { cloudFileArtifact } from "./cloud-file-payload";
import type { ChatArtifact, MobileDisplayPayload } from "../types";

/**
 * A tapped link as a file reference: an absolute path on a computer, or a
 * `stella://drive/...` link to the owner's drive.
 */
export const parseStellaFileUrl = parseFileLinkTarget;

const basenameOf = (filePath: string) => {
  const cleaned = filePath.trim().split(/[?#]/)[0] ?? filePath.trim();
  const slash = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
  return slash === -1 ? cleaned : cleaned.slice(slash + 1);
};

const extensionOf = (filePath: string) => {
  const tail = basenameOf(filePath);
  const dot = tail.lastIndexOf(".");
  return dot <= 0 || dot === tail.length - 1
    ? null
    : tail.slice(dot + 1).toLowerCase();
};

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "heic",
  "heif",
  "avif",
  "svg",
]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const MODEL3D_EXTS = new Set(["glb", "gltf", "obj", "stl"]);
const OFFICE_DOC_EXTS = new Set(["doc", "docx"]);
const OFFICE_SHEET_EXTS = new Set(["xlsx", "xlsm"]);
const OFFICE_SLIDES_EXTS = new Set(["ppt", "pptx"]);
const DELIMITED_TABLE_EXTS = new Set(["csv", "tsv"]);

export const displayPayloadForStellaFile = (
  filePath: string,
  createdAt: number,
  name?: string,
): MobileDisplayPayload => {
  const named = name?.trim() ? { title: name.trim() } : {};
  const title = name?.trim() || basenameOf(filePath);
  const ext = extensionOf(filePath);
  if (ext === "html" || ext === "htm") {
    return { kind: "canvas-html", filePath, title, createdAt };
  }
  if (ext === "pdf") {
    return { kind: "pdf", filePath, title };
  }
  if (ext && IMAGE_EXTS.has(ext)) {
    return {
      kind: "media",
      asset: { kind: "image", filePaths: [filePath] },
      createdAt,
      ...named,
    };
  }
  if (ext && VIDEO_EXTS.has(ext)) {
    return { kind: "media", asset: { kind: "video", filePath }, createdAt, ...named };
  }
  if (ext && AUDIO_EXTS.has(ext)) {
    return { kind: "media", asset: { kind: "audio", filePath }, createdAt, ...named };
  }
  if (ext && MODEL3D_EXTS.has(ext)) {
    return { kind: "media", asset: { kind: "model3d", filePath }, createdAt, ...named };
  }
  if (ext && OFFICE_DOC_EXTS.has(ext)) {
    return {
      kind: "file-artifact",
      filePath,
      artifactKind: "office-document",
      title,
      createdAt,
    };
  }
  if (ext && OFFICE_SHEET_EXTS.has(ext)) {
    return {
      kind: "file-artifact",
      filePath,
      artifactKind: "office-spreadsheet",
      title,
      createdAt,
    };
  }
  if (ext && OFFICE_SLIDES_EXTS.has(ext)) {
    return {
      kind: "file-artifact",
      filePath,
      artifactKind: "office-slides",
      title,
      createdAt,
    };
  }
  if (ext && DELIMITED_TABLE_EXTS.has(ext)) {
    return {
      kind: "file-artifact",
      filePath,
      artifactKind: "delimited-table",
      title,
      createdAt,
    };
  }

  return { kind: "markdown", filePath, title, createdAt };
};

/**
 * A drive file as the viewer opens it: real media for media, else the
 * files-card shape. Either way the bytes come from an owner-scoped drive URL.
 */
export const driveFileChatArtifact = (
  drivePath: string,
  conversationId: string,
  createdAt: number,
  name: string = cloudWorldDriveName(drivePath),
): ChatArtifact => {
  const ext = extensionOf(drivePath);
  const media: MobileDisplayPayload | null =
    ext && IMAGE_EXTS.has(ext)
      ? {
          kind: "media",
          asset: { kind: "image", filePaths: [drivePath] },
          createdAt,
          title: name,
          driveBacked: true,
        }
      : ext && VIDEO_EXTS.has(ext)
        ? {
            kind: "media",
            asset: { kind: "video", filePath: drivePath },
            createdAt,
            title: name,
            driveBacked: true,
          }
        : ext && AUDIO_EXTS.has(ext)
          ? {
              kind: "media",
              asset: { kind: "audio", filePath: drivePath },
              createdAt,
              title: name,
              driveBacked: true,
            }
          : null;
  if (media) {
    return {
      id: `${conversationId}:drive:${drivePath}`,
      conversationId,
      payload: media,
    };
  }
  return cloudFileArtifact(
    { path: drivePath, name, sizeBytes: 0, contentType: "application/octet-stream" },
    conversationId,
    createdAt,
  );
};

export const stellaFileChatArtifact = (
  filePath: string,
  conversationId: string,
): ChatArtifact => {
  // A drive link names a drive file, never one on the paired computer: it
  // opens through a drive URL like a files-card pill.
  const drivePath = driveLinkPath(filePath);
  if (drivePath) {
    return driveFileChatArtifact(drivePath, conversationId, Date.now());
  }
  const payload = displayPayloadForStellaFile(filePath, Date.now());
  return {
    id: `${conversationId}:${payload.kind}:${filePath}`,
    conversationId,
    payload,
  };
};
