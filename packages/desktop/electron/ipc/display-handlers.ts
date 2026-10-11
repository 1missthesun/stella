import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import {
  IPC_DISPLAY_CANVAS_FILE_URL,
  IPC_DISPLAY_CANVAS_HTML_URL,
  IPC_DISPLAY_LIST_CANVAS_HTML,
  IPC_DISPLAY_LIST_FOLDER,
  IPC_DISPLAY_MEDIA_SOURCE,
  IPC_DISPLAY_OPEN_SHARED_CANVAS,
  IPC_DISPLAY_READ_FILE,
  IPC_DISPLAY_STAT_PATH,
  IPC_DISPLAY_TRASH_FORCE_DELETE,
  IPC_DISPLAY_TRASH_LIST,
} from "@stella/contracts/desktop/ipc-channels";
import {
  readConfiguredCanvasShareBaseUrl,
  resolveSharedCanvasPayload,
} from "../services/canvas-share-service.js";
import {
  listDeferredDeletes,
  purgeAllDeferredDeletes,
  purgeDeferredDelete,
} from "@stella/runtime/kernel/tools/deferred-delete";
import type { LocalChatHistoryService } from "../services/local-chat-history-service.js";
import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import { isCloudWorkspacePath } from "@stella/contracts/cloud-world-paths";
import type { LocalChatEventRecord } from "@stella/runtime/kernel/storage/shared";
import {
  MAX_DISPLAY_FILE_BYTES,
  planDisplayFileRead,
} from "./display-read-limit.js";
import {
  EVIDENCE_THUMBNAIL_CONTENT_TYPE,
  isEvidenceThumbnailSource,
} from "@stella/contracts/chat-evidence-thumbnails";
import { renderDesktopEvidenceThumbnail } from "../services/evidence-thumbnail.js";
import {
  canvasUrlForLocalFile,
  MAX_CANVAS_HTML_BYTES,
  registerCanvasHtml,
} from "../source/canvas-protocol.js";
import { resolveJwtOwnerScope } from "@stella/runtime/kernel/runner/computer-agent-cloud-records";
import {
  linkedPathsGrant,
  localChatLinkedPaths,
  pathAndAncestors,
} from "../services/remote-file-grants.js";
import type { PeerDeviceFiles } from "../services/peer-device-files.js";
import {
  DEVICE_FILE_READ_LIMITS,
  DEVICE_FOLDER_CONTENT_TYPE,
  deviceFileReadRanges,
  parseDeviceFolderListing,
  type DeviceFileStat,
  type DeviceFolderEntry,
  type DeviceFolderListing,
} from "@stella/contracts/device-file-reads";
import type { CloudConversationFileGrants } from "../services/cloud-conversation-file-grants.js";
import type { DeviceFileLocator } from "../services/device-file-locator.js";
import {
  deviceFileMissingMessage,
  deviceFileUnavailableMessage,
  type DeviceFileSource,
} from "@stella/contracts/device-files";
import { describeMediaSource } from "../source/media-protocol.js";
import {
  publicDeviceFileSource,
  resolveDeviceFileSource,
  type DeviceFileSourceDeps,
  type ResolvedDeviceFileSource,
} from "../services/device-file-source.js";
import { handleIpc } from "./typed-ipc.js";

type DisplayHandlersOptions = {
  getStellaAppDir: () => string | null;
  getStellaDataDir: () => string | null;
  localChatHistoryService?: LocalChatHistoryService;
  getAuthToken?: () => Promise<string | null>;
  /** Files Stella produced or displayed in a conversation, per its cloud journal. */
  cloudFileGrants?: CloudConversationFileGrants;
  deviceFileLocator?: DeviceFileLocator;
  getDeviceId?: () => string | null;
  /** On pi-durable: the local files Stella linked in a conversation's transcript. */
  piLinkedFiles?: (conversationId: string) => Promise<readonly string[]>;
  /** Reads a file another of the owner's computers has, live. */
  peerDeviceFiles?: PeerDeviceFiles;
  /** The conversation this window shows, for reads that don't name one. */
  getActiveConversationId?: () => string | null;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".c": "text/plain",
  ".cc": "text/plain",
  ".cpp": "text/plain",
  ".cs": "text/plain",
  ".css": "text/css",
  ".go": "text/plain",
  ".h": "text/plain",
  ".hpp": "text/plain",
  ".html": "text/html",
  ".java": "text/plain",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".kt": "text/plain",
  ".mjs": "text/javascript",
  ".php": "text/plain",
  ".py": "text/x-python",
  ".rb": "text/plain",
  ".rs": "text/plain",
  ".scss": "text/x-scss",
  ".sh": "text/x-shellscript",
  ".sql": "application/sql",
  ".svelte": "text/plain",
  ".swift": "text/plain",
  ".toml": "text/plain",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".vue": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  // Video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  // 3D / generic
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "text/plain",
  ".stl": "application/sla",
  ".bin": "application/octet-stream",
};

const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXTENSION));

/** The most one ranged read returns; a relayed response must stay well under its cap. */
const MAX_RANGE_READ_BYTES = 2 * DEVICE_FILE_READ_LIMITS.rangeBytes;
const MAX_FOLDER_MANIFEST_BYTES = 1024 * 1024;

const listLocalFolder = async (
  folderPath: string,
): Promise<DeviceFolderListing> => {
  const dirents = await fs.readdir(folderPath, { withFileTypes: true });
  const visible = dirents.filter((entry) => !entry.name.startsWith("."));
  const entries: DeviceFolderEntry[] = [];
  for (const entry of visible) {
    if (entries.length >= DEVICE_FILE_READ_LIMITS.folderEntries) break;
    const entryPath = path.join(folderPath, entry.name);
    const stats = await fs.stat(entryPath).catch(() => null);
    if (!stats || (!stats.isFile() && !stats.isDirectory())) continue;
    entries.push({
      name: entry.name,
      path: entryPath,
      kind: stats.isDirectory() ? "directory" : "file",
      sizeBytes: stats.isDirectory() ? 0 : stats.size,
      modifiedAt: stats.mtimeMs,
    });
  }
  entries.sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : a.kind === "directory"
        ? -1
        : 1,
  );
  return {
    path: folderPath,
    entries,
    truncated: visible.length > entries.length,
  };
};

/** Head of a canvas document; the `<title>` is written near the top of it. */
const CANVAS_TITLE_SCAN_BYTES = 8192;
const CANVAS_TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

/**
 * The title the canvas itself declares, which is what the author named it —
 * the slug is a filename, and reads as one in a file list.
 */
const canvasDocumentTitle = async (
  filePath: string,
): Promise<string | null> => {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(CANVAS_TITLE_SCAN_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const title = CANVAS_TITLE_RE.exec(
      buffer.subarray(0, bytesRead).toString("utf8"),
    )?.[1];
    if (!title) return null;
    const decoded = title
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
};

export const isDisplayReadPathInLocalChatFiles = (
  events: ReadonlyArray<LocalChatEventRecord>,
  requestedPath: string,
): boolean => {
  const resolvedRequestedPath = path.resolve(requestedPath);
  for (const event of events) {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") continue;

    const responseText =
      event.type === "assistant_message" && typeof payload.text === "string"
        ? payload.text
        : event.type === "agent-completed" && typeof payload.result === "string"
          ? payload.result
          : "";
    for (const filePath of extractLocalFileLinkPaths(responseText)) {
      if (path.resolve(filePath) === resolvedRequestedPath) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Subdirectories of `~/.stella` the phone may read from directly.
 *
 * These hold artifacts Stella itself produced and already renders in the UI
 * (generated media, `outputs/<app>/…` result files). The mirrored desktop UI
 * on the phone is the *same* bundle, so its media viewers — and user apps that
 * read their own output directory — need them to load at all.
 *
 * Everything else under `~/.stella` stays off-limits: credential stores like
 * `llm_credentials.json` and `connectors/.credentials.json` live at the root
 * and in sibling directories, and `.json` is an allowed display extension.
 */
const MOBILE_READABLE_DATA_SUBDIRS = ["outputs", "media"] as const;

/**
 * Marks an error as "this was refused because the caller is the phone, not
 * because anything is broken". The phone shows the message as is, so a
 * refusal reads as a policy answer rather than a broken file.
 */
export const REMOTE_VIEW_DENIAL_PREFIX = "Not available in phone view: ";

/** True when `candidate` is `base` itself or sits underneath it. */
const isPathInside = (candidate: string, base: string): boolean =>
  candidate === base || candidate.startsWith(base + path.sep);

/**
 * Resolves the deepest existing ancestor of `target` and re-appends the part
 * that does not exist yet.
 *
 * A plain `realpath` is not enough on its own: it throws for a file that has
 * not been written yet, and the caller still needs those to reach the handler's
 * soft "missing" result rather than being refused. Resolving the ancestor also
 * normalizes symlinked parents (on macOS the temp and home trees sit behind
 * `/var` -> `/private/var`), which a lexical comparison would get wrong.
 */
const resolveThroughSymlinks = async (target: string): Promise<string> => {
  let current = target;
  const trailing: string[] = [];
  // Bounded by the path depth; `path.dirname` is a fixed point at the root.
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...trailing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      trailing.push(path.basename(current));
      current = parent;
    }
  }
};

/**
 * True when the phone may read `resolvedPath` without a conversation.
 *
 * Symlinks are resolved before the containment check so a link planted inside
 * `outputs/` (e.g. by a prompt-injected agent) can't be used to read a
 * credential file that the extension allowlist would otherwise permit.
 */
export const isMobileReadableStellaPath = async (
  resolvedPath: string,
  stellaDataDir: string | null,
): Promise<boolean> => {
  if (!stellaDataDir) return false;
  const realPath = await resolveThroughSymlinks(resolvedPath);
  const realDataDir = await resolveThroughSymlinks(path.resolve(stellaDataDir));
  return MOBILE_READABLE_DATA_SUBDIRS.some((subdir) =>
    isPathInside(realPath, path.join(realDataDir, subdir)),
  );
};

/**
 * A cloud-world path reaching a local read is a routing mistake, not a missing
 * file. `/workspace/...` is the cloud sandbox; this machine has no such tree,
 * so `path.resolve` keeps it absolute, `fs.stat` raises ENOENT, and the handler
 * below reports `missing` — which every viewer renders as the file being gone.
 * That is false twice over: the file exists, and it was only ever asked of the
 * wrong machine.
 *
 * Refusing here rather than at a single call site is deliberate: this handler
 * is the one door onto the local filesystem for the whole display lane, so one
 * condition covers the tapped `stella://file` link, the activity hub, the
 * completion pills' `MediaPreviewCard`, the inline image tile, the canvas/PDF/
 * spreadsheet viewers and the canvas share bar's direct read. It also backs
 * a paired phone's `file.read` relayed through the cloud, so a phone whose
 * client-side guard is older still gets a true answer instead of a false one.
 *
 * Drive files never get here: the renderer maps `world/drive/...` onto an
 * owner-scoped drive URL through `cloudWorldDrivePath` first, and only a world
 * path the drive rule rejects falls through to this lane.
 */
const assertNotCloudWorkspacePath = (filePath: string): void => {
  if (!isCloudWorkspacePath(filePath)) return;
  throw new Error(
    "This file lives in Stella's cloud workspace, not on this computer, so it can't be opened here. Ask Stella to put it in your Drive.",
  );
};

export const registerDisplayHandlers = (options: DisplayHandlersOptions) => {
  const requireStellaDataDir = () => {
    const stellaDataDir = options.getStellaDataDir();
    if (!stellaDataDir) {
      throw new Error("Stella home is unavailable.");
    }
    return stellaDataDir;
  };

  /**
   * `display:readFile` for the desktop renderer (`remote: false`) and for a
   * phone's or another computer's `file.read` relayed through the cloud
   * (`remote: true`), which is held to Stella's own outputs, the
   * conversation's linked files and folders, and what this computer shared.
   */
  const deviceFileDeps = (): DeviceFileSourceDeps | null =>
    options.deviceFileLocator
      ? {
          locator: options.deviceFileLocator,
          getDeviceId: () => options.getDeviceId?.() ?? null,
        }
      : null;

  const conversationOf = (payload: { conversationId?: unknown } | undefined) =>
    typeof payload?.conversationId === "string"
      ? payload.conversationId.trim()
      : "";

  const rangeOf = (payload: {
    offset?: unknown;
    length?: unknown;
  } | undefined): { offset: number; length: number } | null => {
    const offset = payload?.offset;
    const length = payload?.length;
    if (offset === undefined && length === undefined) return null;
    if (
      typeof offset !== "number" ||
      typeof length !== "number" ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1
    ) {
      throw new Error("display:readFile offset and length must be whole numbers.");
    }
    return { offset, length: Math.min(length, MAX_RANGE_READ_BYTES) };
  };

  const readPeerBytes = async (
    deviceId: string,
    requestedPath: string,
    from: number,
    to: number,
    conversationId: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> => {
    const peers = options.peerDeviceFiles!;
    const parts: Uint8Array[] = [];
    let mimeType = "application/octet-stream";
    let total = 0;
    for (const range of deviceFileReadRanges(to - from)) {
      const part = await peers.read(
        deviceId,
        requestedPath,
        { offset: from + range.offset, length: range.length },
        conversationId,
      );
      mimeType = part.mimeType;
      parts.push(part.bytes);
      total += part.bytes.byteLength;
      if (part.bytes.byteLength < range.length) break;
    }
    const bytes = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
      bytes.set(part, cursor);
      cursor += part.byteLength;
    }
    return { bytes, mimeType };
  };

  /**
   * The computer that has a file this one does not: the one its device
   * record names first, then any other online computer of the owner.
   */
  const findPeerHolder = async (
    requestedPath: string,
    conversationId: string,
    source: ResolvedDeviceFileSource | null,
  ) => {
    if (!options.peerDeviceFiles) return null;
    const preferred =
      source && (source.kind === "drive" || source.kind === "elsewhere")
        ? (source.deviceId ?? null)
        : null;
    return await options.peerDeviceFiles
      .findHolder(requestedPath, { preferred, conversationId })
      .catch(() => null);
  };

  const readFromOwningDevice = async (
    requestedPath: string,
    resolvedPath: string,
    maxBytes: unknown,
    mimeType: string,
    range: { offset: number; length: number } | null,
    conversationId: string,
  ) => {
    const source = await resolveDeviceFileSource(
      requestedPath,
      deviceFileDeps(),
    );
    if (source.kind === "local") {
      return null;
    }
    const holder = await findPeerHolder(requestedPath, conversationId, source);
    if (holder) {
      if (holder.stat.kind !== "file") {
        throw new Error(`display:readFile target is not a file: ${resolvedPath}`);
      }
      const sizeBytes = holder.stat.sizeBytes;
      let from = 0;
      let to: number;
      if (range) {
        from = Math.min(range.offset, sizeBytes);
        to = Math.min(sizeBytes, from + range.length);
      } else {
        const plan = planDisplayFileRead(sizeBytes, maxBytes);
        if (!plan.ok) throw new Error(plan.error);
        to = plan.readBytes;
      }
      const read = await readPeerBytes(
        holder.computer.deviceId,
        requestedPath,
        from,
        to,
        conversationId,
      );
      return {
        bytes: read.bytes,
        sizeBytes,
        mimeType: holder.stat.mimeType || read.mimeType || mimeType,
        truncated: !range && read.bytes.byteLength < sizeBytes,
        missing: false as const,
      };
    }
    switch (source.kind) {
      case "drive": {
        const locator = options.deviceFileLocator!;
        if (range) {
          const copy = await locator.readCopy(
            source.drivePath,
            Math.min(source.sizeBytes || MAX_DISPLAY_FILE_BYTES, range.offset + range.length),
          );
          return {
            bytes: copy.bytes.subarray(Math.min(range.offset, copy.bytes.byteLength)),
            sizeBytes: copy.sizeBytes,
            mimeType,
            truncated: false,
            missing: false as const,
          };
        }
        const plan = planDisplayFileRead(source.sizeBytes, maxBytes);
        if (!plan.ok) {
          throw new Error(plan.error);
        }
        const copy = await locator.readCopy(source.drivePath, plan.readBytes);
        return {
          bytes: copy.bytes,
          sizeBytes: copy.sizeBytes,
          mimeType,
          truncated: copy.bytes.byteLength < copy.sizeBytes,
          missing: false as const,
        };
      }
      case "missing":
        return {
          missing: true as const,
          mimeType,
          path: resolvedPath,
          reason: "deleted" as const,
        };
      case "unshared":
        return {
          missing: true as const,
          mimeType,
          path: resolvedPath,
          reason: "unshared" as const,
        };
      case "elsewhere":
      case "unreachable":
        throw new Error(
          deviceFileUnavailableMessage(
            publicDeviceFileSource(source),
            requestedPath,
          ),
        );
    }
  };

  const linkSources = (
    conversationId: string,
  ): Array<() => Promise<readonly string[]>> => [
    async () =>
      options.localChatHistoryService
        ? localChatLinkedPaths(
            options.localChatHistoryService.listFiles({
              conversationId,
              limit: 500,
            }).files,
          )
        : [],
    // Any conversation of this owner, not just the one this window shows:
    // a file Stella produced or displayed there, per the cloud journal, is
    // one the user has already been shown.
    async () =>
      options.cloudFileGrants
        ? await options.cloudFileGrants.listPaths(conversationId)
        : [],
    async () =>
      options.piLinkedFiles
        ? await options.piLinkedFiles(conversationId).catch(() => [])
        : [],
  ];

  /** Files and folders this computer itself shared from a reply or report. */
  const sharedByThisComputer = async (resolved: string): Promise<boolean> => {
    const deviceId = options.getDeviceId?.() ?? null;
    if (!deviceId || !options.deviceFileLocator) return false;
    const recorded = await options.deviceFileLocator
      .recordedBy(pathAndAncestors(resolved).slice(0, 48), deviceId)
      .catch(() => new Set<string>());
    return recorded.size > 0 && (await linkedPathsGrant(resolved, [...recorded]));
  };

  /**
   * `granted`: read it here. `elsewhere`: it is not on this computer, so the
   * computer that has it decides, under its own policy.
   */
  const remoteAccess = async (
    resolved: string,
    conversationId: string,
  ): Promise<"granted" | "elsewhere"> => {
    // Stella's own artifact directories are readable without a
    // conversation: apps rendered in the phone's mirrored UI (and the
    // shell's media viewers) read their result files directly, and have
    // no conversation to attribute the read to.
    if (await isMobileReadableStellaPath(resolved, options.getStellaDataDir())) {
      return "granted";
    }
    const here = await fs.lstat(resolved).then(
      () => true,
      () => false,
    );
    if (!here && conversationId) return "elsewhere";
    if (here && conversationId) {
      for (const source of linkSources(conversationId)) {
        if (await linkedPathsGrant(resolved, await source().catch(() => []))) {
          return "granted";
        }
      }
    }
    if (here && (await sharedByThisComputer(resolved))) return "granted";
    if (!conversationId) {
      throw new Error(
        `${REMOTE_VIEW_DENIAL_PREFIX}this file is outside Stella's own outputs and media, and no conversation was supplied to check it against.`,
      );
    }
    throw new Error(
      `${REMOTE_VIEW_DENIAL_PREFIX}Stella didn't share this file in the conversation, so it can only be opened on the computer that has it.`,
    );
  };

  const authorizePath = async (
    payload: { filePath?: unknown; conversationId?: unknown } | undefined,
    access: { remote: boolean },
  ) => {
    const requestedPath =
      typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
    if (!requestedPath) {
      throw new Error("display:readFile requires a filePath.");
    }
    assertNotCloudWorkspacePath(requestedPath);
    const resolved = path.resolve(requestedPath);
    const conversationId = conversationOf(payload);
    const elsewhere = access.remote
      ? (await remoteAccess(resolved, conversationId)) === "elsewhere"
      : false;
    return { requestedPath, resolved, conversationId, elsewhere };
  };

  const authorizeDisplayRead = async (
    payload:
      | {
          filePath?: unknown;
          conversationId?: unknown;
        }
      | undefined,
    access: { remote: boolean },
  ) => {
    const authorized = await authorizePath(payload, access);
    const extension = path.extname(authorized.resolved).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error(
        `display:readFile only supports: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
      );
    }
    const mimeType = MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
    return { ...authorized, mimeType };
  };

  const readDisplayFile = async (
    payload:
      | {
          filePath?: unknown;
          conversationId?: unknown;
          maxBytes?: unknown;
          offset?: unknown;
          length?: unknown;
        }
      | undefined,
    access: { remote: boolean },
  ) => {
    const { requestedPath, resolved, mimeType, conversationId, elsewhere } =
      await authorizeDisplayRead(payload, access);
    const range = rangeOf(payload);
    const viewerConversation =
      conversationId || (access.remote ? "" : (options.getActiveConversationId?.() ?? ""));

    // Paths can outlive the file they point at — e.g. an `image_gen` /
    // tool-result registered a path in `generatedMediaItems`, and the
    // underlying file was later moved or deleted (especially for paths
    // outside `~/.stella/`). Treat ENOENT as a soft "missing" result so the
    // renderer can render a placeholder instead of surfacing the raw
    // IPC error to the console / UI.
    let stats: Awaited<ReturnType<typeof fs.stat>> | null = null;
    if (!elsewhere) {
      try {
        stats = await fs.stat(resolved);
      } catch (caught) {
        if (
          !caught ||
          typeof caught !== "object" ||
          (caught as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          throw caught;
        }
      }
    }
    if (!stats) {
      const remote = await readFromOwningDevice(
        requestedPath,
        resolved,
        payload?.maxBytes,
        mimeType,
        range,
        viewerConversation,
      );
      if (remote) return remote;
      stats = await fs.stat(resolved);
    }
    if (!stats.isFile()) {
      throw new Error(`display:readFile target is not a file: ${resolved}`);
    }

    if (range) {
      const from = Math.min(range.offset, stats.size);
      const length = Math.min(range.length, stats.size - from);
      const handle = await fs.open(resolved, "r");
      let buffer = Buffer.alloc(length);
      try {
        const { bytesRead } = await handle.read(buffer, 0, length, from);
        if (bytesRead < length) buffer = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      return {
        bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
        sizeBytes: stats.size,
        mimeType,
        truncated: false,
        missing: false as const,
      };
    }

    const plan = planDisplayFileRead(stats.size, payload?.maxBytes);
    if (!plan.ok) {
      throw new Error(plan.error);
    }

    let buffer: Buffer;
    if (plan.readBytes === stats.size) {
      buffer = await fs.readFile(resolved);
    } else {
      const handle = await fs.open(resolved, "r");
      try {
        buffer = Buffer.alloc(plan.readBytes);
        const { bytesRead } = await handle.read(buffer, 0, plan.readBytes, 0);
        if (bytesRead < plan.readBytes) {
          buffer = buffer.subarray(0, bytesRead);
        }
      } finally {
        await handle.close();
      }
    }
    // Return the raw bytes; Electron's structured-clone IPC transport
    // ships `Uint8Array` directly without the +33% base64 overhead and
    // without forcing the renderer to spin a JS loop to decode it.
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    return {
      bytes,
      sizeBytes: stats.size,
      mimeType,
      truncated: buffer.byteLength < stats.size,
      missing: false as const,
    };
  };

  const mimeTypeOf = (filePath: string) =>
    MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";

  /** Where a path is and what it is: a file or a folder, here or on another computer. */
  const statPath = async (
    payload: { filePath?: unknown; conversationId?: unknown } | undefined,
    access: { remote: boolean },
  ): Promise<DeviceFileStat & { deviceName?: string; deviceId?: string }> => {
    const { requestedPath, resolved, conversationId, elsewhere } =
      await authorizePath(payload, access);
    const stats = elsewhere ? null : await fs.stat(resolved).catch(() => null);
    if (stats) {
      return {
        kind: stats.isDirectory() ? "directory" : "file",
        sizeBytes: stats.isDirectory() ? 0 : stats.size,
        mimeType: stats.isDirectory() ? "inode/directory" : mimeTypeOf(resolved),
        modifiedAt: stats.mtimeMs,
      };
    }
    const viewerConversation =
      conversationId || (access.remote ? "" : (options.getActiveConversationId?.() ?? ""));
    const source = await resolveDeviceFileSource(requestedPath, deviceFileDeps());
    const holder = await findPeerHolder(requestedPath, viewerConversation, source);
    if (holder) {
      return {
        ...holder.stat,
        deviceId: holder.computer.deviceId,
        deviceName: holder.computer.label,
      };
    }
    if (source.kind === "drive") {
      if (source.contentType === DEVICE_FOLDER_CONTENT_TYPE) {
        return {
          kind: "directory",
          sizeBytes: 0,
          mimeType: "inode/directory",
          modifiedAt: 0,
          deviceName: source.deviceName,
        };
      }
      return {
        kind: "file",
        sizeBytes: source.sizeBytes,
        mimeType: source.contentType || mimeTypeOf(resolved),
        modifiedAt: 0,
        deviceName: source.deviceName,
      };
    }
    throw new Error(
      deviceFileUnavailableMessage(
        source.kind === "local" ? { kind: "missing" } : publicDeviceFileSource(source),
        requestedPath,
      ),
    );
  };

  /** A folder's entries, here or on the computer that has it. */
  const listFolder = async (
    payload: { filePath?: unknown; conversationId?: unknown } | undefined,
    access: { remote: boolean },
  ): Promise<DeviceFolderListing & { deviceName?: string }> => {
    const { requestedPath, resolved, conversationId, elsewhere } =
      await authorizePath(payload, access);
    const stats = elsewhere ? null : await fs.stat(resolved).catch(() => null);
    if (stats) {
      if (!stats.isDirectory()) {
        throw new Error(`Not a folder: ${resolved}`);
      }
      return await listLocalFolder(resolved);
    }
    const viewerConversation =
      conversationId || (access.remote ? "" : (options.getActiveConversationId?.() ?? ""));
    const source = await resolveDeviceFileSource(requestedPath, deviceFileDeps());
    const holder = await findPeerHolder(requestedPath, viewerConversation, source);
    if (holder) {
      const listing = await options.peerDeviceFiles!.list(
        holder.computer.deviceId,
        requestedPath,
        viewerConversation,
      );
      return { ...listing, deviceName: holder.computer.label };
    }
    if (
      source.kind === "drive" &&
      source.contentType === DEVICE_FOLDER_CONTENT_TYPE &&
      options.deviceFileLocator
    ) {
      const copy = await options.deviceFileLocator.readCopy(
        source.drivePath,
        MAX_FOLDER_MANIFEST_BYTES,
      );
      const listing = parseDeviceFolderListing(
        JSON.parse(Buffer.from(copy.bytes).toString("utf8")),
      );
      if (listing) return { ...listing, deviceName: source.deviceName };
    }
    throw new Error(
      deviceFileUnavailableMessage(
        source.kind === "local" ? { kind: "missing" } : publicDeviceFileSource(source),
        requestedPath,
      ),
    );
  };

  handleIpc(
    IPC_DISPLAY_READ_FILE,
    async (
      event,
      payload?: {
        filePath?: unknown;
        conversationId?: unknown;
        maxBytes?: unknown;
      },
    ) => {
      if (!options.assertPrivilegedSender(event, IPC_DISPLAY_READ_FILE)) {
        throw new Error(`Blocked untrusted ${IPC_DISPLAY_READ_FILE} request.`);
      }
      return await readDisplayFile(payload, { remote: false });
    },
  );

  handleIpc(
    IPC_DISPLAY_MEDIA_SOURCE,
    async (
      event,
      payload?: { filePath?: unknown },
    ): Promise<DeviceFileSource> => {
      if (!options.assertPrivilegedSender(event, IPC_DISPLAY_MEDIA_SOURCE)) {
        throw new Error(
          `Blocked untrusted ${IPC_DISPLAY_MEDIA_SOURCE} request.`,
        );
      }
      const filePath =
        typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
      if (!filePath) {
        throw new Error(`${IPC_DISPLAY_MEDIA_SOURCE} requires a filePath.`);
      }
      try {
        assertNotCloudWorkspacePath(filePath);
      } catch (caught) {
        return {
          kind: "unreachable",
          message: caught instanceof Error ? caught.message : String(caught),
        };
      }
      return await describeMediaSource(filePath);
    },
  );

  handleIpc(IPC_DISPLAY_LIST_CANVAS_HTML, async (event) => {
    if (!options.assertPrivilegedSender(event, IPC_DISPLAY_LIST_CANVAS_HTML)) {
      throw new Error(
        `Blocked untrusted ${IPC_DISPLAY_LIST_CANVAS_HTML} request.`,
      );
    }

    const htmlDir = path.join(requireStellaDataDir(), "outputs", "html");
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(htmlDir, { withFileTypes: true });
    } catch (caught) {
      if (
        caught &&
        typeof caught === "object" &&
        (caught as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw caught;
    }

    const items = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
        .map(async (entry) => {
          const filePath = path.join(htmlDir, entry.name);
          const stats = await fs.stat(filePath);
          const slug = entry.name.slice(0, -".html".length);
          return {
            filePath,
            slug,
            title:
              (await canvasDocumentTitle(filePath)) ??
              slug
                .replace(/[-_]+/g, " ")
                .replace(/\b\w/g, (char: string) => char.toUpperCase()),
            createdAt: stats.mtimeMs,
          };
        }),
    );

    return items.sort((a, b) => a.createdAt - b.createdAt);
  });

  handleIpc(
    IPC_DISPLAY_OPEN_SHARED_CANVAS,
    async (event, payload?: { url?: unknown }) => {
      if (
        !options.assertPrivilegedSender(event, IPC_DISPLAY_OPEN_SHARED_CANVAS)
      ) {
        throw new Error(
          `Blocked untrusted ${IPC_DISPLAY_OPEN_SHARED_CANVAS} request.`,
        );
      }
      const url = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!url) return null;
      return await resolveSharedCanvasPayload({
        url,
        baseUrl: readConfiguredCanvasShareBaseUrl(),
        stellaDataDir: requireStellaDataDir(),
      });
    },
  );

  // Canvases render from `stella-canvas://` (source/canvas-protocol.ts). A
  // file on this computer is served from disk with its own folder, so its
  // relative images, styles and scripts load; a file kept on another device
  // is read through the display lane above and held in memory, like a cloud
  // canvas's HTML.
  handleIpc(
    IPC_DISPLAY_CANVAS_FILE_URL,
    async (event, payload?: { filePath?: unknown }) => {
      if (!options.assertPrivilegedSender(event, IPC_DISPLAY_CANVAS_FILE_URL)) {
        throw new Error(
          `Blocked untrusted ${IPC_DISPLAY_CANVAS_FILE_URL} request.`,
        );
      }
      const filePath =
        typeof payload?.filePath === "string" ? payload.filePath.trim() : "";
      if (!filePath) {
        throw new Error(`${IPC_DISPLAY_CANVAS_FILE_URL} requires a filePath.`);
      }
      assertNotCloudWorkspacePath(filePath);
      const url = await canvasUrlForLocalFile(filePath);
      if (url) return { url };
      const read = await readDisplayFile(
        { filePath, maxBytes: MAX_CANVAS_HTML_BYTES },
        { remote: false },
      );
      if (read.missing) {
        return {
          missing: true as const,
          message: deviceFileMissingMessage(read.reason, filePath),
        };
      }
      if (read.truncated) {
        throw new Error(
          `Canvas too large to display (${read.sizeBytes} bytes, limit ${MAX_CANVAS_HTML_BYTES}).`,
        );
      }
      const bytes = Buffer.from(
        read.bytes.buffer,
        read.bytes.byteOffset,
        read.bytes.byteLength,
      );
      return { url: registerCanvasHtml(bytes.toString("utf8")) };
    },
  );

  handleIpc(
    IPC_DISPLAY_CANVAS_HTML_URL,
    (event, payload?: { html?: unknown }) => {
      if (!options.assertPrivilegedSender(event, IPC_DISPLAY_CANVAS_HTML_URL)) {
        throw new Error(
          `Blocked untrusted ${IPC_DISPLAY_CANVAS_HTML_URL} request.`,
        );
      }
      const html = typeof payload?.html === "string" ? payload.html : "";
      if (!html) {
        throw new Error(`${IPC_DISPLAY_CANVAS_HTML_URL} requires html.`);
      }
      return { url: registerCanvasHtml(html) };
    },
  );

  handleIpc(IPC_DISPLAY_TRASH_LIST, async (event) => {
    if (!options.assertPrivilegedSender(event, IPC_DISPLAY_TRASH_LIST)) {
      throw new Error(`Blocked untrusted ${IPC_DISPLAY_TRASH_LIST} request.`);
    }
    return await listDeferredDeletes({ stellaDataDir: requireStellaDataDir() });
  });

  handleIpc(
    IPC_DISPLAY_TRASH_FORCE_DELETE,
    async (event, payload?: { id?: unknown; all?: unknown }) => {
      if (
        !options.assertPrivilegedSender(event, IPC_DISPLAY_TRASH_FORCE_DELETE)
      ) {
        throw new Error(
          `Blocked untrusted ${IPC_DISPLAY_TRASH_FORCE_DELETE} request.`,
        );
      }

      const stellaDataDir = requireStellaDataDir();
      if (payload?.all === true) {
        return await purgeAllDeferredDeletes({ stellaDataDir });
      }
      const id = typeof payload?.id === "string" ? payload.id : "";
      return await purgeDeferredDelete(id, { stellaDataDir });
    },
  );

  handleIpc(
    IPC_DISPLAY_STAT_PATH,
    async (event, payload?: { filePath?: unknown; conversationId?: unknown }) => {
      if (!options.assertPrivilegedSender(event, IPC_DISPLAY_STAT_PATH)) {
        throw new Error(`Blocked untrusted ${IPC_DISPLAY_STAT_PATH} request.`);
      }
      return await statPath(payload, { remote: false });
    },
  );

  handleIpc(
    IPC_DISPLAY_LIST_FOLDER,
    async (event, payload?: { filePath?: unknown; conversationId?: unknown }) => {
      if (!options.assertPrivilegedSender(event, IPC_DISPLAY_LIST_FOLDER)) {
        throw new Error(`Blocked untrusted ${IPC_DISPLAY_LIST_FOLDER} request.`);
      }
      return await listFolder(payload, { remote: false });
    },
  );

  return {
    /** A phone's or another computer's `file.read`, under the remote read policy. */
    readFileForRequest: (payload: {
      filePath?: unknown;
      conversationId?: unknown;
      offset?: unknown;
      length?: unknown;
    }) => readDisplayFile(payload, { remote: true }),
    statForRequest: (payload: { filePath?: unknown; conversationId?: unknown }) =>
      statPath(payload, { remote: true }),
    listForRequest: (payload: { filePath?: unknown; conversationId?: unknown }) =>
      listFolder(payload, { remote: true }),
    readThumbnailForRequest: async (payload: {
      filePath?: unknown;
      conversationId?: unknown;
    }) => {
      const { resolved, elsewhere } = await authorizeDisplayRead(payload, {
        remote: true,
      });
      const thumbnail = !elsewhere && isEvidenceThumbnailSource(resolved)
        ? await renderDesktopEvidenceThumbnail(resolved)
        : null;
      if (thumbnail) {
        return {
          missing: false as const,
          bytes: new Uint8Array(
            thumbnail.buffer,
            thumbnail.byteOffset,
            thumbnail.byteLength,
          ),
          mimeType: EVIDENCE_THUMBNAIL_CONTENT_TYPE,
        };
      }
      return await readDisplayFile(payload, { remote: true });
    },
  };
};
