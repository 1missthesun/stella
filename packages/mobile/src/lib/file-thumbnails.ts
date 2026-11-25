import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { File } from "expo-file-system";
import {
  evidenceDrivePath,
  evidenceSourceFile,
  requestEvidencePreview,
} from "./chat-evidence-previews";
import { embedDriveHtmlAssets } from "./drive-html";
import { useDriveFileVersion } from "./drive-file-versions";
import type { StoredPhoneAccess } from "./phone-access";

export type FileThumbnailKind =
  | "image"
  | "video"
  | "audio"
  | "html"
  | "document"
  | "text"
  | "none";

export type FileThumbnail =
  | { kind: "image"; uri: string }
  | { kind: "audio"; peaks: number[] }
  | { kind: "html"; html: string; linksExpire: boolean }
  | { kind: "document"; uri: string }
  | { kind: "text"; text: string };

export type FileThumbnailSource = {
  filePath: string;
  kind: FileThumbnailKind;
  conversationId: string;
  access: StoredPhoneAccess | null;
};

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const MAX_DEVICE_MEDIA_BYTES = 16 * 1024 * 1024;
const TEXT_PREVIEW_CHARS = 1_600;
const SETTLE_MS = 90;
const MAX_REMEMBERED = 160;
const MAX_REMEMBERED_HTML_CHARS = 256 * 1024;

const KIND_BY_EXTENSION: Record<string, FileThumbnailKind> = {};
const kinds = (kind: FileThumbnailKind, list: string) => {
  for (const extension of list.split(" ")) KIND_BY_EXTENSION[extension] = kind;
};
kinds("image", "png jpg jpeg gif webp heic heif bmp avif svg");
kinds("video", "mp4 mov m4v webm");
kinds("audio", "mp3 wav m4a aac flac ogg");
kinds("html", "html htm");
kinds(
  "text",
  "md markdown txt csv tsv json yaml yml toml xml css scss sql js mjs cjs ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh zsh bash lua dart log",
);
if (Platform.OS === "ios") kinds("document", "pdf doc docx xls xlsx ppt pptx");

export const fileExtension = (name: string): string =>
  /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? "";

export const fileThumbnailKind = (extension: string): FileThumbnailKind =>
  KIND_BY_EXTENSION[extension] ?? "none";

const readText = async (uri: string, limit: number): Promise<string> => {
  const text = await new File(uri).text();
  return text.length > limit ? text.slice(0, limit) : text;
};

const load = async (source: FileThumbnailSource): Promise<FileThumbnail> => {
  const { filePath, kind, conversationId, access } = source;
  if (kind === "image" && /^(?:file|https?|data):/i.test(filePath)) {
    return { kind: "image", uri: filePath };
  }
  if (kind === "image" || kind === "video" || kind === "audio") {
    const preview = await requestEvidencePreview({
      filePath,
      kind,
      conversationId,
      access,
      maxDeviceBytes: MAX_DEVICE_MEDIA_BYTES,
    });
    if (preview.kind === "image" || preview.kind === "page") {
      return { kind: "image", uri: preview.uri };
    }
    if (preview.kind === "video") return { kind: "image", uri: preview.posterUri };
    return { kind: "audio", peaks: preview.peaks };
  }
  const request = { filePath, kind: "plain" as const, conversationId, access };
  if (kind === "text") {
    const file = await evidenceSourceFile(request, MAX_TEXT_BYTES);
    return { kind: "text", text: await readText(file.uri, TEXT_PREVIEW_CHARS) };
  }
  if (kind === "html") {
    const file = await evidenceSourceFile(request, MAX_HTML_BYTES);
    const html = await readText(file.uri, MAX_HTML_BYTES);
    const drivePath = evidenceDrivePath(filePath);
    const embedded = drivePath
      ? await embedDriveHtmlAssets(html, drivePath).catch(() => html)
      : html;
    return { kind: "html", html: embedded, linksExpire: embedded !== html };
  }
  if (kind === "document") {
    return {
      kind: "document",
      uri: (await evidenceSourceFile(request, MAX_DOCUMENT_BYTES)).uri,
    };
  }
  throw new Error("No thumbnail for this file.");
};

const remembered = new Map<string, FileThumbnail>();

const remember = (key: string, thumbnail: FileThumbnail): void => {
  if (
    thumbnail.kind === "html" &&
    (thumbnail.linksExpire ||
      thumbnail.html.length > MAX_REMEMBERED_HTML_CHARS)
  ) {
    return;
  }
  remembered.delete(key);
  remembered.set(key, thumbnail);
  while (remembered.size > MAX_REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) return;
    remembered.delete(oldest);
  }
};

export const clearFileThumbnails = (): void => remembered.clear();

export type FileThumbnailState =
  | { status: "pending" }
  | { status: "ready"; thumbnail: FileThumbnail }
  | { status: "none" };

const PENDING: FileThumbnailState = { status: "pending" };
const NONE: FileThumbnailState = { status: "none" };

export const useFileThumbnail = (
  source: FileThumbnailSource,
): FileThumbnailState => {
  const { filePath, kind, conversationId, access } = source;
  const drivePath = kind === "none" ? null : evidenceDrivePath(filePath);
  const version = useDriveFileVersion(drivePath);
  const key = `${conversationId}|${kind}|${filePath}|${version ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    state: FileThumbnailState;
  } | null>(null);

  useEffect(() => {
    if (kind === "none" || remembered.has(key)) return;
    let alive = true;
    const timer = setTimeout(() => {
      load({ filePath, kind, conversationId, access }).then(
        (thumbnail) => {
          remember(key, thumbnail);
          if (alive) setResult({ key, state: { status: "ready", thumbnail } });
        },
        () => {
          if (alive) setResult({ key, state: NONE });
        },
      );
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, filePath, kind, conversationId, access]);

  if (kind === "none") return NONE;
  const known = remembered.get(key);
  if (known) return { status: "ready", thumbnail: known };
  if (result?.key === key) return result.state;
  return result?.state.status === "ready" ? result.state : PENDING;
};
