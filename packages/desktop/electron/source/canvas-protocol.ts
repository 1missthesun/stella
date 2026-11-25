import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { app, session } from "electron";
import { isDocumentFolderAsset } from "@stella/contracts/html-relative-assets";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import { canvasPolicyDirectives } from "@stella/contracts/canvas-host";
import {
  CANVAS_ACTION_MANIFEST_MAX_BYTES,
  injectCanvasActionBridge,
  readCanvasActionManifest,
  type CanvasAction,
} from "@stella/contracts/canvas-actions";

export const CANVAS_SCHEME = "stella-canvas";
const DIRECTORY_HOST = "dir";
const MEMORY_HOST = "memory";

export const CANVAS_SCHEME_PRIVILEGES = {
  scheme: CANVAS_SCHEME,
  privileges: { standard: true, secure: true },
} as const;

export const MAX_CANVAS_HTML_BYTES = 48 * 1024 * 1024;
const MAX_REGISTERED_CANVASES = 32;
const MAX_REGISTERED_BYTES = 128 * 1024 * 1024;
const MAX_DOCUMENT_DIRECTORIES = 256;
const MAX_CANVAS_ASSET_BYTES = 256 * 1024 * 1024;
const MAX_REMOTE_ASSET_BYTES = 32 * 1024 * 1024;

const ASSET_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".m4v": "video/mp4",
  ".flac": "audio/flac",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

const CANVAS_CSP = ["sandbox allow-scripts allow-forms", ...canvasPolicyDirectives({ self: true })].join("; ");

const canvasResponse = (
  status: number,
  body: string | ReadableStream<Uint8Array>,
  contentType = "text/plain; charset=utf-8",
  extraHeaders: Record<string, string> = {},
) =>
  new Response(body, {
    status,
    headers: {
      ...extraHeaders,
      "content-type": contentType,
      "content-security-policy": CANVAS_CSP,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });

export const isCanvasUrl = (url: string): boolean =>
  url.startsWith(`${CANVAS_SCHEME}:`);

export const isRegisteredCanvasUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${CANVAS_SCHEME}:` || parsed.host !== MEMORY_HOST) {
      return false;
    }
    const id = parsed.pathname.split("/")[1];
    return Boolean(id && registered.has(id));
  } catch {
    return false;
  }
};

export type CanvasDocumentAssetSource = "device" | "drive";

const registered = new Map<
  string,
  {
    html: string;
    bytes: number;
    digest: string;
    documentPath: string | null;
    assetSource: CanvasDocumentAssetSource;
  }
>();
const idByDigest = new Map<string, string>();
let registeredBytes = 0;

const touchRegistered = (id: string) => {
  const entry = registered.get(id);
  if (!entry) return null;
  registered.delete(id);
  registered.set(id, entry);
  return entry;
};

const documentNameOf = (documentPath: string) =>
  documentPath.split(/[\\/]/u).pop() || "index.html";

const memoryUrl = (id: string, documentPath: string | null) =>
  documentPath
    ? `${CANVAS_SCHEME}://${MEMORY_HOST}/${id}/${encodeURIComponent(documentNameOf(documentPath))}`
    : `${CANVAS_SCHEME}://${MEMORY_HOST}/${id}`;

export const registerCanvasHtml = (
  html: string,
  documentPath: string | null = null,
  assetSource: CanvasDocumentAssetSource = "device",
): string => {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_CANVAS_HTML_BYTES) {
    throw new Error(
      `Canvas too large to display (${bytes} bytes, limit ${MAX_CANVAS_HTML_BYTES}).`,
    );
  }
  const digest = createHash("sha256")
    .update(html)
    .update("\0")
    .update(documentPath ?? "")
    .update("\0")
    .update(assetSource)
    .digest("hex");
  const existing = idByDigest.get(digest);
  if (existing && touchRegistered(existing)) {
    return memoryUrl(existing, documentPath);
  }
  const id = randomBytes(18).toString("base64url");
  registered.set(id, { html, bytes, digest, documentPath, assetSource });
  idByDigest.set(digest, id);
  registeredBytes += bytes;
  for (const [oldestId, oldest] of registered) {
    if (
      registered.size <= MAX_REGISTERED_CANVASES &&
      registeredBytes <= MAX_REGISTERED_BYTES
    ) {
      break;
    }
    if (oldestId === id) break;
    registered.delete(oldestId);
    idByDigest.delete(oldest.digest);
    registeredBytes -= oldest.bytes;
  }
  return memoryUrl(id, documentPath);
};

export type CanvasDocumentAssetRead = {
  bytes: Uint8Array;
  sizeBytes: number;
  mimeType: string;
};

export type CanvasDocumentAssetReader = (
  filePath: string,
  range: { offset: number; length: number } | null,
  maxBytes: number,
) => Promise<CanvasDocumentAssetRead | null>;

const documentAssetReaders = new Map<
  CanvasDocumentAssetSource,
  CanvasDocumentAssetReader
>();

export const setCanvasDocumentAssetReader = (
  reader: CanvasDocumentAssetReader | null,
  source: CanvasDocumentAssetSource = "device",
) => {
  if (reader) documentAssetReaders.set(source, reader);
  else documentAssetReaders.delete(source);
};

const realpathOrNull = async (target: string) => {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
};

const isHtmlPath = (target: string) => {
  const extension = path.extname(target).toLowerCase();
  return extension === ".html" || extension === ".htm";
};

const directoryByToken = new Map<string, string>();
const tokenByDirectory = new Map<string, string>();

const tokenForDirectory = (directory: string) => {
  const existing = tokenByDirectory.get(directory);
  if (existing) {
    directoryByToken.delete(existing);
    directoryByToken.set(existing, directory);
    return existing;
  }
  const token = randomBytes(18).toString("base64url");
  directoryByToken.set(token, directory);
  tokenByDirectory.set(directory, token);
  for (const [oldestToken, oldestDirectory] of directoryByToken) {
    if (directoryByToken.size <= MAX_DOCUMENT_DIRECTORIES) break;
    directoryByToken.delete(oldestToken);
    tokenByDirectory.delete(oldestDirectory);
  }
  return token;
};

export const canvasUrlForLocalFile = async (
  filePath: string,
): Promise<string | null> => {
  if (!isHtmlPath(filePath)) return null;
  const file = await realpathOrNull(path.resolve(filePath));
  if (!file || !isHtmlPath(file)) return null;
  const stats = await fs.stat(file).catch(() => null);
  if (!stats?.isFile()) return null;
  const token = tokenForDirectory(path.dirname(file));
  return `${CANVAS_SCHEME}://${DIRECTORY_HOST}/${token}/${encodeURIComponent(path.basename(file))}`;
};

export const canvasActionsOfLocalFile = async (
  filePath: string,
): Promise<CanvasAction[]> => {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(path.resolve(filePath), "r");
    const buffer = Buffer.alloc(CANVAS_ACTION_MANIFEST_MAX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return readCanvasActionManifest(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

type CanvasDocument =
  | { kind: "html"; html: string }
  | { kind: "file"; file: string; size: number }
  | {
      kind: "asset";
      documentPath: string;
      assetPath: string;
      assetSource: CanvasDocumentAssetSource;
    };

const documentAssetPath = (
  documentPath: string,
  segments: string[],
): string | null => {
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment || segment.startsWith(".") || /[\\/\0]/u.test(segment),
    )
  ) {
    return null;
  }
  const slash = Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\"));
  if (slash < 0) return null;
  const separator = documentPath[slash]!;
  const assetPath = documentPath.slice(0, slash + 1) + segments.join(separator);
  return isDocumentFolderAsset(documentPath, assetPath) ? assetPath : null;
};

const resolveDirectoryFile = async (
  token: string,
  segments: string[],
): Promise<{ file: string; size: number } | null> => {
  const directory = directoryByToken.get(token);
  if (!directory || segments.length === 0) return null;
  if (
    segments.some(
      (segment) =>
        !segment || segment.startsWith(".") || /[\\/\0]/.test(segment),
    )
  ) {
    return null;
  }
  const root = await realpathOrNull(directory);
  const file = await realpathOrNull(path.join(directory, ...segments));
  if (!root || !file || !file.startsWith(root + path.sep)) return null;
  if (path.relative(root, file).split(path.sep).some((part) => part.startsWith("."))) {
    return null;
  }
  const stats = await fs.stat(file).catch(() => null);
  if (!stats?.isFile()) return null;
  return { file, size: stats.size };
};

const readCanvasDocument = async (url: string): Promise<CanvasDocument | null> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let segments: string[];
  try {
    segments = parsed.pathname.split("/").slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parsed.host === MEMORY_HOST) {
    const [id, ...rest] = segments;
    const entry = id ? touchRegistered(id) : null;
    if (!entry) return null;
    if (rest.length === 0) return { kind: "html", html: entry.html };
    if (!entry.documentPath) return null;
    if (rest.length === 1 && rest[0] === documentNameOf(entry.documentPath)) {
      return { kind: "html", html: entry.html };
    }
    const assetPath = documentAssetPath(entry.documentPath, rest);
    return assetPath
      ? {
          kind: "asset",
          documentPath: entry.documentPath,
          assetPath,
          assetSource: entry.assetSource,
        }
      : null;
  }
  if (parsed.host !== DIRECTORY_HOST) return null;
  const [token, ...rest] = segments;
  if (!token) return null;
  const resolved = await resolveDirectoryFile(token, rest);
  if (!resolved) return null;
  if (!isHtmlPath(resolved.file)) {
    return resolved.size > MAX_CANVAS_ASSET_BYTES
      ? null
      : { kind: "file", ...resolved };
  }
  if (resolved.size > MAX_CANVAS_HTML_BYTES) return null;
  const html = await fs.readFile(resolved.file, "utf8").catch(() => null);
  return html === null ? null : { kind: "html", html };
};

const assetResponse = (file: string, size: number) => {
  const contentType =
    ASSET_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return canvasResponse(200, stream, contentType, {
    "content-length": String(size),
  });
};

const parseRange = (header: string | null) => {
  const match = header ? /^bytes=(\d+)-(\d*)$/u.exec(header.trim()) : null;
  if (!match) return null;
  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : null;
  if (!Number.isSafeInteger(offset) || (end !== null && end < offset)) return null;
  return {
    offset,
    length: end === null ? MAX_CANVAS_ASSET_BYTES : end - offset + 1,
  };
};

const documentAssetResponse = async (
  assetPath: string,
  assetSource: CanvasDocumentAssetSource,
  rangeHeader: string | null,
) => {
  const reader = documentAssetReaders.get(assetSource);
  if (!reader) return canvasResponse(404, "Not found");
  const range = parseRange(rangeHeader);
  const read = await reader(assetPath, range, MAX_REMOTE_ASSET_BYTES).catch(
    () => null,
  );
  if (!read) return canvasResponse(404, "Not found");
  const extension = /\.[a-z0-9]+$/iu.exec(assetPath)?.[0]?.toLowerCase() ?? "";
  const contentType =
    ASSET_TYPES[extension] ?? (read.mimeType || "application/octet-stream");
  const body = new Blob([read.bytes as Uint8Array<ArrayBuffer>]).stream();
  if (!range) {
    if (read.bytes.byteLength < read.sizeBytes) {
      return canvasResponse(413, "Too large to show here");
    }
    return canvasResponse(200, body, contentType, {
      "content-length": String(read.bytes.byteLength),
      "accept-ranges": "bytes",
    });
  }
  if (range.offset >= read.sizeBytes) {
    return canvasResponse(416, "Range not satisfiable", "text/plain; charset=utf-8", {
      "content-range": `bytes */${read.sizeBytes}`,
    });
  }
  const last = range.offset + read.bytes.byteLength - 1;
  return canvasResponse(206, body, contentType, {
    "content-length": String(read.bytes.byteLength),
    "content-range": `bytes ${range.offset}-${last}/${read.sizeBytes}`,
    "accept-ranges": "bytes",
  });
};

export const serveCanvasProtocol = (partition: string) => {
  const partitionSession = session.fromPartition(partition);
  if (partitionSession.protocol.isProtocolHandled(CANVAS_SCHEME)) return;
  partitionSession.protocol.handle(CANVAS_SCHEME, async (request) => {
    if (request.method !== "GET") return canvasResponse(405, "Method not allowed");
    const document = await readCanvasDocument(request.url);
    if (document === null) return canvasResponse(404, "Not found");
    if (document.kind === "file") return assetResponse(document.file, document.size);
    if (document.kind === "asset") {
      return await documentAssetResponse(
        document.assetPath,
        document.assetSource,
        request.headers.get("range"),
      );
    }
    return canvasResponse(
      200,
      injectCanvasBridge(injectCanvasActionBridge(document.html)),
      "text/html; charset=utf-8",
    );
  });
};

export const guardCanvasFrames = () => {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-frame-navigate", (details) => {
      const frame = details.frame;
      if (details.isMainFrame || !frame || !isCanvasUrl(frame.url)) return;
      if (details.url === frame.url) return;
      if (details.initiator && !isCanvasUrl(details.initiator.url)) return;
      details.preventDefault();
    });
  });
};
