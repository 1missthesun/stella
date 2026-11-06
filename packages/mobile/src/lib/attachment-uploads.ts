import { AppState, Platform } from "react-native";
import { useMemo, useSyncExternalStore } from "react";
import { BackendRequestError } from "@stella/contracts/backend/client";
import { File, UploadTask, UploadType } from "expo-file-system";
import { getBackendClient } from "./backend";
import {
  driveAttachmentPath,
  uploadChatAttachment,
  type PickedAttachment,
} from "./chat-attachments";
import { attachmentContentType } from "./image-attachments";

export type AttachmentUploadState =
  | { status: "uploading" }
  | { status: "ready"; drivePath: string }
  | { status: "failed"; message: string };

export type AttachmentUploadSource = Pick<
  PickedAttachment,
  "id" | "uri" | "name" | "mimeType" | "sizeBytes" | "kind"
>;

type Entry = {
  source: AttachmentUploadSource;
  path: string;
  state: AttachmentUploadState;
  run: Promise<string> | null;
  abort: AbortController;
  permanent: boolean;
};

const MAX_AUTOMATIC_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;
const HEAD_BYTES = 64;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

const emit = () => {
  version += 1;
  for (const listener of listeners) listener();
};

const setState = (entry: Entry, state: AttachmentUploadState) => {
  entry.state = state;
  emit();
};

class PermanentUploadError extends Error {}

const isPermanent = (error: unknown) =>
  error instanceof PermanentUploadError ||
  (error instanceof BackendRequestError &&
    !error.retryable &&
    error.code !== "UNAVAILABLE" &&
    error.reason !== "upload_not_found" &&
    error.reason !== "timeout");

const uploadErrorMessage = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "This attachment didn't upload.";

const uniquePrefix = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2))
    .replace(/-/g, "")
    .slice(0, 8);

const reservedPaths = () =>
  new Set([...entries.values()].map((entry) => entry.path));

const readHead = (file: File): Uint8Array => {
  const handle = file.open();
  try {
    return handle.readBytes(HEAD_BYTES);
  } finally {
    handle.close();
  }
};

const uploadFromFile = async (
  source: AttachmentUploadSource,
  path: string,
  signal: AbortSignal,
): Promise<string> => {
  const file = new File(source.uri);
  if (!file.exists) {
    throw new PermanentUploadError("This file is no longer on your phone.");
  }
  const sizeBytes = file.size ?? source.sizeBytes;
  const contentType = attachmentContentType(readHead(file), source.mimeType);
  const client = getBackendClient();
  const prepared = await client.call("drive.prepareUpload", {
    path,
    sizeBytes,
    contentType,
  });
  const task = new UploadTask(file, prepared.uploadUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": prepared.contentType },
    sessionType: "background",
    signal,
  });
  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status}).`);
  }
  const finalized = await client.call("drive.finalizeUpload", {
    path: prepared.path,
    uploadId: prepared.uploadId,
    contentType,
    source: "mobile-chat",
  });
  return finalized.path;
};

const uploadOnce = (entry: Entry): Promise<string> =>
  Platform.OS === "web"
    ? uploadChatAttachment(entry.source, new Set(), {
        client: getBackendClient(),
        readFile: async (uri) => await new File(uri).bytes(),
        path: entry.path,
      })
    : uploadFromFile(entry.source, entry.path, entry.abort.signal);

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const run = (entry: Entry): Promise<string> => {
  if (entry.run) return entry.run;
  if (entry.state.status === "ready") return Promise.resolve(entry.state.drivePath);
  if (entry.state.status !== "uploading") setState(entry, { status: "uploading" });
  const attempt = async (): Promise<string> => {
    for (let tries = 1; ; tries += 1) {
      try {
        const drivePath = await uploadOnce(entry);
        if (entry.abort.signal.aborted) throw new Error("Upload removed.");
        setState(entry, { status: "ready", drivePath });
        return drivePath;
      } catch (error) {
        if (entry.abort.signal.aborted) throw error;
        if (isPermanent(error) || tries >= MAX_AUTOMATIC_ATTEMPTS) {
          entry.permanent = isPermanent(error);
          setState(entry, { status: "failed", message: uploadErrorMessage(error) });
          throw error;
        }
        const appActive = AppState.currentState === "active";
        await wait(
          appActive ? BASE_BACKOFF_MS * 2 ** (tries - 1) : BASE_BACKOFF_MS,
          entry.abort.signal,
        );
        if (!appActive) await untilAppActive(entry.abort.signal);
      }
    }
  };
  entry.run = attempt().finally(() => {
    entry.run = null;
  });
  return entry.run;
};

const untilAppActive = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (AppState.currentState === "active") {
      resolve();
      return;
    }
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      subscription.remove();
      resolve();
    });
    signal.addEventListener(
      "abort",
      () => {
        subscription.remove();
        resolve();
      },
      { once: true },
    );
  });

const ensureEntry = (
  source: AttachmentUploadSource,
  path?: string,
): Entry => {
  const existing = entries.get(source.id);
  if (existing) return existing;
  const entry: Entry = {
    source,
    path:
      path ??
      driveAttachmentPath({
        name: source.name,
        kind: source.kind,
        now: new Date(),
        taken: reservedPaths(),
        uniquePrefix: uniquePrefix(),
      }),
    state: { status: "uploading" },
    run: null,
    abort: new AbortController(),
    permanent: false,
  };
  entries.set(source.id, entry);
  emit();
  return entry;
};

/** Starts (or joins) the background upload and returns the Drive path it will land at. */
export const startAttachmentUpload = (source: AttachmentUploadSource): string => {
  const entry = ensureEntry(source);
  void run(entry).catch(() => undefined);
  return entry.path;
};

/**
 * Resolves with the final Drive path once the upload lands. Restarts a failed
 * upload, and recreates one lost to an app relaunch from its local file.
 */
export const awaitAttachmentUpload = (
  source: AttachmentUploadSource,
  path: string,
): Promise<string> => run(ensureEntry(source, path));

export const retryAttachmentUpload = (id: string) => {
  const entry = entries.get(id);
  if (!entry || entry.state.status !== "failed") return;
  void run(entry).catch(() => undefined);
};

export const discardAttachmentUpload = (id: string) => {
  const entry = entries.get(id);
  if (!entry) return;
  entries.delete(id);
  if (entry.state.status !== "ready") entry.abort.abort();
  emit();
};

export const attachmentUploadState = (
  id: string,
): AttachmentUploadState | undefined => entries.get(id)?.state;

AppState.addEventListener("change", (next) => {
  if (next !== "active") return;
  for (const entry of entries.values()) {
    if (entry.state.status === "failed" && !entry.permanent && !entry.run) {
      void run(entry).catch(() => undefined);
    }
  }
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Re-renders when any upload changes state; read individual states with attachmentUploadState. */
export const useAttachmentUploadsVersion = (): number =>
  useSyncExternalStore(subscribe, () => version);

/** Which of these uploads have failed, re-rendering only when that set changes. */
export const useFailedAttachmentUploads = (
  ids: readonly string[],
): ReadonlySet<string> => {
  const key = useSyncExternalStore(subscribe, () =>
    ids.filter((id) => entries.get(id)?.state.status === "failed").join("\n"),
  );
  return useMemo(() => new Set(key ? key.split("\n") : []), [key]);
};
