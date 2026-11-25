import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import {
  evidenceDrivePath,
  evidenceImageFile,
  evidenceSourceFile,
  requestEvidencePreview,
  requestPagePreview,
} from "./chat-evidence-previews";
import { embedDriveHtmlAssets } from "./drive-html";
import { useDriveFileVersion } from "./drive-file-versions";
import { afterFilesScrollSettles } from "./files-scroll-activity";
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
  | { kind: "image"; uri: string; sized?: boolean }
  | { kind: "page"; uri: string }
  | { kind: "pdf"; uri: string }
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
const RETRY_AFTER_MS = 60_000;
const MAX_KEPT = 600;
const SAVE_AFTER_MS = 1_500;
const TILE_IMAGE_BOX = 1_080;
const INDEX_VERSION = 1;

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

const directory = (): Directory => {
  const folder = new Directory(Paths.cache, "file-thumbnails");
  try {
    folder.create({ intermediates: true, idempotent: true });
  } catch {}
  return folder;
};

const hashOf = (value: string): string => {
  let hash = 5381;
  let mix = 52711;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash = (hash * 33) ^ code;
    mix = (mix * 31) ^ (code + index);
  }
  return `${(hash >>> 0).toString(16)}${(mix >>> 0).toString(16)}`;
};

/**
 * expo-image resizes an oversized bitmap to its view on the main thread every
 * time it is shown, so a full camera photo stalls scrolling for 50-150 ms. A
 * tile gets a copy decoded once, off the main thread, small enough to show as is.
 */
const tileImage = async (
  sourceUri: string,
  identity: string,
): Promise<FileThumbnail> => {
  const original: FileThumbnail = { kind: "image", uri: sourceUri };
  if (Platform.OS !== "ios" || !sourceUri.startsWith("file:")) return original;
  const target = new File(directory(), `${hashOf(identity)}.img`);
  if (target.exists && (target.size ?? 0) > 0) {
    return { kind: "image", uri: target.uri, sized: true };
  }
  const cacheKey = `stella-file-tile:${hashOf(identity)}`;
  try {
    const decoded = await Image.loadAsync(
      { uri: sourceUri },
      { maxWidth: TILE_IMAGE_BOX, maxHeight: TILE_IMAGE_BOX },
    );
    try {
      await Image.writeToCacheAsync(decoded, cacheKey);
    } finally {
      decoded.release();
    }
    const written = await Image.getCachePathAsync(cacheKey);
    if (!written) return original;
    const file = new File(written.startsWith("file:") ? written : `file://${written}`);
    if (target.exists) target.delete();
    file.moveSync(target);
    return { kind: "image", uri: target.uri, sized: true };
  } catch {
    return original;
  }
};

const readText = async (uri: string, limit: number): Promise<string> => {
  const text = await new File(uri).text();
  return text.length > limit ? text.slice(0, limit) : text;
};

const liveHtml = async (
  request: Parameters<typeof evidenceSourceFile>[0],
  filePath: string,
): Promise<FileThumbnail> => {
  const file = await evidenceSourceFile(request, MAX_HTML_BYTES);
  const html = await readText(file.uri, MAX_HTML_BYTES);
  const drivePath = evidenceDrivePath(filePath);
  const embedded = drivePath
    ? await embedDriveHtmlAssets(html, drivePath).catch(() => html)
    : html;
  return { kind: "html", html: embedded, linksExpire: embedded !== html };
};

const load = async (
  source: FileThumbnailSource,
  identity: string,
): Promise<FileThumbnail> => {
  const { filePath, kind, conversationId, access } = source;
  if (kind === "image" && /^(?:https?|data):/i.test(filePath)) {
    return { kind: "image", uri: filePath };
  }
  if (kind === "image" && filePath.startsWith("file:")) {
    return await tileImage(filePath, identity);
  }
  const media = {
    filePath,
    conversationId,
    access,
    maxDeviceBytes: MAX_DEVICE_MEDIA_BYTES,
  };
  if (kind === "image") {
    const uri = await evidenceImageFile({ ...media, kind: "image" });
    return await tileImage(uri, identity);
  }
  if (kind === "video" || kind === "audio") {
    const preview = await requestEvidencePreview({ ...media, kind });
    if (preview.kind === "video") {
      return await tileImage(preview.posterUri, identity);
    }
    if (preview.kind === "audio") return { kind: "audio", peaks: preview.peaks };
    throw new Error("No thumbnail for this file.");
  }
  const request = { filePath, kind: "plain" as const, conversationId, access };
  if (kind === "text") {
    const file = await evidenceSourceFile(request, MAX_TEXT_BYTES);
    return { kind: "text", text: await readText(file.uri, TEXT_PREVIEW_CHARS) };
  }
  if (kind === "html") {
    const page = await requestPagePreview(
      { filePath, kind: "page", conversationId, access },
      "page",
    ).catch(() => null);
    if (page?.kind === "page") return { kind: "page", uri: page.uri };
    return await liveHtml(request, filePath);
  }
  if (kind === "document") {
    const file = await evidenceSourceFile(request, MAX_DOCUMENT_BYTES);
    return fileExtension(filePath) === "pdf"
      ? { kind: "pdf", uri: file.uri }
      : { kind: "document", uri: file.uri };
  }
  throw new Error("No thumbnail for this file.");
};

type Kept = { version: string; thumbnail: FileThumbnail };

let kept: Map<string, Kept> | null = null;
const failed = new Map<string, number>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const indexFile = (): File => new File(directory(), "index.json");

const lasting = (thumbnail: FileThumbnail): boolean =>
  thumbnail.kind !== "html";

const stillThere = (thumbnail: FileThumbnail): boolean => {
  if (!("uri" in thumbnail)) return true;
  if (!thumbnail.uri.startsWith("file:")) return true;
  try {
    return new File(thumbnail.uri).exists;
  } catch {
    return false;
  }
};

const keptEntries = (): Map<string, Kept> => {
  if (kept) return kept;
  kept = new Map();
  try {
    const file = indexFile();
    if (!file.exists) return kept;
    const parsed = JSON.parse(file.textSync()) as {
      version?: number;
      entries?: [string, Kept][];
    };
    if (parsed.version !== INDEX_VERSION || !Array.isArray(parsed.entries)) {
      return kept;
    }
    for (const [id, entry] of parsed.entries) {
      if (entry?.thumbnail && stillThere(entry.thumbnail)) kept.set(id, entry);
    }
  } catch {}
  return kept;
};

const save = (): void => {
  saveTimer = null;
  const entries = [...keptEntries()].filter(([, entry]) =>
    lasting(entry.thumbnail),
  );
  try {
    const file = indexFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify({ version: INDEX_VERSION, entries }));
  } catch {}
};

const scheduleSave = (): void => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => afterFilesScrollSettles(save), SAVE_AFTER_MS);
};

const derivedFile = (thumbnail: FileThumbnail): File | null => {
  if (!("uri" in thumbnail)) return null;
  try {
    const file = new File(thumbnail.uri);
    return file.parentDirectory.uri === directory().uri ? file : null;
  } catch {
    return null;
  }
};

const keep = (id: string, version: string, thumbnail: FileThumbnail): void => {
  const entries = keptEntries();
  const previous = entries.get(id);
  entries.delete(id);
  entries.set(id, { version, thumbnail });
  if (
    previous &&
    "uri" in previous.thumbnail &&
    "uri" in thumbnail &&
    previous.thumbnail.uri !== thumbnail.uri
  ) {
    derivedFile(previous.thumbnail)?.delete();
  }
  while (entries.size > MAX_KEPT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    const dropped = entries.get(oldest);
    entries.delete(oldest);
    if (dropped) {
      try {
        derivedFile(dropped.thumbnail)?.delete();
      } catch {}
    }
  }
  if (lasting(thumbnail)) scheduleSave();
};

export const clearFileThumbnails = (): void => {
  kept = new Map();
  failed.clear();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const folder = new Directory(Paths.cache, "file-thumbnails");
    if (folder.exists) folder.delete();
  } catch {}
};

export type FileThumbnailState =
  | { status: "pending" }
  | { status: "ready"; thumbnail: FileThumbnail }
  | { status: "none" };

const PENDING: FileThumbnailState = { status: "pending" };
const NONE: FileThumbnailState = { status: "none" };

const readyStates = new WeakMap<FileThumbnail, FileThumbnailState>();
const ready = (thumbnail: FileThumbnail): FileThumbnailState => {
  let state = readyStates.get(thumbnail);
  if (!state) {
    state = { status: "ready", thumbnail };
    readyStates.set(thumbnail, state);
  }
  return state;
};

export const useFileThumbnail = (
  source: FileThumbnailSource,
): FileThumbnailState => {
  const { filePath, kind, conversationId, access } = source;
  const drivePath = kind === "none" ? null : evidenceDrivePath(filePath);
  const driveVersion = useDriveFileVersion(drivePath);
  const id = `${conversationId}|${kind}|${filePath}`;
  const version =
    drivePath === null ? "" : driveVersion === undefined ? null : (driveVersion ?? "");
  const known = kind === "none" ? undefined : keptEntries().get(id);
  const fresh = known !== undefined && (version === null || known.version === version);
  const [loaded, setLoaded] = useState<{
    id: string;
    version: string;
    state: FileThumbnailState;
  } | null>(null);
  const settled =
    loaded !== null && loaded.id === id && loaded.version === version;

  useEffect(() => {
    if (kind === "none" || fresh || settled || version === null) return;
    const failedAt = failed.get(`${id}|${version}`);
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) {
      setLoaded({ id, version, state: NONE });
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      load({ filePath, kind, conversationId, access }, `${id}|${version}`).then(
        (thumbnail) => {
          failed.delete(`${id}|${version}`);
          keep(id, version, thumbnail);
          if (alive) setLoaded({ id, version, state: ready(thumbnail) });
        },
        () => {
          failed.set(`${id}|${version}`, Date.now());
          if (alive) setLoaded({ id, version, state: NONE });
        },
      );
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [access, conversationId, filePath, fresh, id, kind, settled, version]);

  if (kind === "none") return NONE;
  if (fresh) return ready(known.thumbnail);
  if (settled) return loaded.state;
  if (known) return ready(known.thumbnail);
  return PENDING;
};
