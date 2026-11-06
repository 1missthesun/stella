import { useSyncExternalStore } from "react";
import {
  CHAT_ATTACHMENT_FOLDERS,
  chatAttachmentDrivePath,
} from "@stella/contracts/chat-attachments";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_EDGE,
  CHAT_IMAGE_PASSTHROUGH_TYPES,
} from "@stella/contracts/chat-image-limits";
import { backendClient } from "@/platform/backend/backend-client";
import type { CloudAttachment } from "./cloud-composer-store";
import {
  RequestTimeoutError,
  retryIdempotent,
  transferBudgetMs,
} from "@stella/contracts/request-deadline";

export const BROWSER_ATTACHMENT_MAX_FILES = 10;
const BROWSER_IMAGE_SOURCE_MAX_BYTES = 100 * 1024 * 1024;

export type BrowserAttachmentUpload = {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  path: string | null;
  previewUrl: string | null;
  progress: number;
  status: "pending" | "uploading" | "finalizing" | "ready" | "error";
  error: string | null;
  /** The pending message this upload was sent with; null while it is in the composer. */
  sentWith: string | null;
  retryable: boolean;
  /** The preview is a video's first frame. */
  poster?: true;
};

let uploads: readonly BrowserAttachmentUpload[] = [];
const listeners = new Set<() => void>();
const activeRequests = new Map<string, XMLHttpRequest>();
const notify = () => listeners.forEach((listener) => listener());
const replace = (id: string, patch: Partial<BrowserAttachmentUpload>) => {
  uploads = uploads.map((entry) =>
    entry.id === id ? { ...entry, ...patch } : entry,
  );
  notify();
};

const revokePreview = (entry: BrowserAttachmentUpload): void => {
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
};

const videoPosterUrl = (file: File): Promise<string | null> =>
  new Promise((resolve) => {
    const source = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (url: string | null) => {
      URL.revokeObjectURL(source);
      video.removeAttribute("src");
      video.load();
      resolve(url);
    };
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, video.duration || 0);
    };
    video.onseeked = () => {
      const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return finish(null);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => finish(blob ? URL.createObjectURL(blob) : null),
        "image/jpeg",
        0.8,
      );
    };
    video.src = source;
  });

const waitForUploadChange = (): Promise<void> =>
  new Promise((resolve) => {
    const listener = () => {
      listeners.delete(listener);
      resolve();
    };
    listeners.add(listener);
  });

export class AttachmentUploadFailedError extends Error {
  constructor(name: string, detail: string | null) {
    super(detail || `Couldn’t upload ${name}.`);
    this.name = "AttachmentUploadFailedError";
  }
}

/**
 * The finished Drive files for these uploads, in order, once every one has
 * landed. Rejects as soon as one has failed past its automatic retries.
 */
export const waitForAttachmentUploads = async (
  ids: readonly string[],
): Promise<CloudAttachment[]> => {
  for (;;) {
    const entries = ids.map((id) => uploads.find((entry) => entry.id === id));
    const missing = ids.findIndex((_, index) => !entries[index]);
    if (missing >= 0) {
      throw new AttachmentUploadFailedError(
        "an attachment",
        "This attachment is no longer available. Attach it again.",
      );
    }
    const failed = entries.find((entry) => entry!.status === "error");
    if (failed) throw new AttachmentUploadFailedError(failed.name, failed.error);
    if (entries.every((entry) => entry!.status === "ready")) {
      return entries.map((entry) => ({
        path: entry!.path!,
        name: entry!.name,
        sizeBytes: entry!.sizeBytes,
        contentType: attachmentContentType({
          declared: entry!.file.type,
          name: entry!.name,
        }),
      }));
    }
    await waitForUploadChange();
  }
};

const rejectReason = (file: File): string | null =>
  file.size <= 0 ? "This file is empty." : null;

export const browserAttachmentDrivePath = (
  file: Pick<File, "name">,
  id: string,
  now = new Date(),
): string =>
  chatAttachmentDrivePath({
    folder: CHAT_ATTACHMENT_FOLDERS.web,
    name: file.name,
    now,
    prefix: id.slice(-8),
  });

const UPLOAD_LABEL = "Uploading to Stella's Drive";

const uploadFailure = (message: string, retryable: boolean): Error =>
  Object.assign(new Error(message), { retryable });

const uploadCanceled = (): Error =>
  Object.assign(new Error("Upload canceled."), { name: "AbortError" });

const putOnceWithProgress = (
  upload: BrowserAttachmentUpload,
  url: string,
  contentType: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!uploads.some((entry) => entry.id === upload.id)) {
      reject(uploadCanceled());
      return;
    }
    const request = new XMLHttpRequest();
    const timeoutMs = transferBudgetMs(upload.file.size);
    activeRequests.set(upload.id, request);
    request.open("PUT", url);
    request.timeout = timeoutMs;
    request.setRequestHeader("content-type", contentType);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        replace(upload.id, {
          progress: Math.max(0, Math.min(0.99, event.loaded / event.total)),
        });
      }
    };
    request.onerror = () =>
      reject(uploadFailure("The upload connection failed.", true));
    request.ontimeout = () =>
      reject(new RequestTimeoutError(UPLOAD_LABEL, timeoutMs));
    request.onabort = () => reject(uploadCanceled());
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          uploadFailure(
            `Upload failed (${request.status}).`,
            request.status >= 500,
          ),
        );
    };
    request.onloadend = () => activeRequests.delete(upload.id);
    request.send(upload.file);
  });

const putWithProgress = (
  upload: BrowserAttachmentUpload,
  url: string,
  contentType: string,
): Promise<void> =>
  retryIdempotent(() => putOnceWithProgress(upload, url, contentType), {
    attempts: 3,
  });

const canvasBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn’t resize this image.")),
      type,
      quality,
    );
  });

const imageFile = (blob: Blob, source: File): File => {
  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  const stem = source.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.${extension}`, {
    type: blob.type,
    lastModified: source.lastModified,
  });
};

/**
 * An attached image fitted to what the model takes (the long edge and byte
 * budget in `chat-image-limits`) as soon as it is attached, so the upload is
 * small and the cloud sends it as it is. One already within the limits, in a
 * type every provider takes, uploads untouched (a screenshot stays lossless,
 * a GIF animated). An image the browser can't decode (HEIC outside Safari),
 * or one too large to decode safely here,
 * uploads as it is and the cloud fits it instead.
 */
export const fitBrowserChatImage = async (file: File): Promise<File> => {
  const type = attachmentContentType({ declared: file.type, name: file.name });
  if (
    !type.startsWith("image/") ||
    type === "image/svg+xml" ||
    file.size > BROWSER_IMAGE_SOURCE_MAX_BYTES
  ) {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height, 1);
    if (
      CHAT_IMAGE_PASSTHROUGH_TYPES.has(type) &&
      file.size <= CHAT_IMAGE_MAX_BYTES &&
      longEdge <= CHAT_IMAGE_MAX_EDGE
    ) {
      return file;
    }
    // A photo stays JPEG; anything that may carry transparency goes to WebP.
    let output = type === "image/jpeg" ? "image/jpeg" : "image/webp";
    let scale = Math.min(1, CHAT_IMAGE_MAX_EDGE / longEdge);
    let quality = 0.86;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image resizing isn’t available.");
      if (output === "image/jpeg") {
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas, output, quality);
      if (blob.type !== output) {
        // This browser can't encode WebP; JPEG on white instead.
        output = "image/jpeg";
        continue;
      }
      if (blob.size <= CHAT_IMAGE_MAX_BYTES) return imageFile(blob, file);
      quality = Math.max(0.6, quality - 0.08);
      if (attempt >= 2) scale *= 0.85;
    }
    throw new Error("This image couldn’t be made small enough to send.");
  } finally {
    bitmap.close();
  }
};

const uploadOne = async (
  upload: BrowserAttachmentUpload,
  attempt = 0,
): Promise<void> => {
  try {
    const file = await fitBrowserChatImage(upload.file);
    const path = browserAttachmentDrivePath(file, upload.id);
    const contentType = attachmentContentType({
      declared: file.type,
      name: file.name,
    });
    const preparedUpload = { ...upload, file };
    replace(upload.id, {
      file,
      name: file.name,
      sizeBytes: file.size,
      status: "uploading",
      progress: 0,
      error: null,
      path,
    });
    const prepared = await backendClient.call("drive.prepareUpload", {
      path,
      sizeBytes: file.size,
      contentType,
    });
    await putWithProgress(
      preparedUpload,
      prepared.uploadUrl,
      prepared.contentType,
    );
    replace(upload.id, { status: "finalizing", progress: 0.99 });
    const finalized = await backendClient.call("drive.finalizeUpload", {
      path: prepared.path,
      uploadId: prepared.uploadId,
      contentType,
      source: "web-chat",
    });
    replace(upload.id, {
      status: "ready",
      path: finalized.path,
      progress: 1,
      error: null,
    });
  } catch (error) {
    if (!uploads.some((entry) => entry.id === upload.id)) return;
    const retryable = isRetryableUploadError(error);
    if (retryable && attempt + 1 < AUTOMATIC_UPLOAD_ATTEMPTS) {
      await untilOnline();
      await new Promise((resolve) =>
        setTimeout(resolve, 1_000 * 2 ** attempt),
      );
      if (!uploads.some((entry) => entry.id === upload.id)) return;
      return uploadOne(upload, attempt + 1);
    }
    replace(upload.id, {
      status: "error",
      retryable,
      error: error instanceof Error ? error.message : "Upload failed.",
    });
  }
};

const AUTOMATIC_UPLOAD_ATTEMPTS = 5;

const isRetryableUploadError = (error: unknown): boolean => {
  if (error instanceof Error && error.name === "AbortError") return false;
  const flagged =
    error && typeof error === "object" ? Reflect.get(error, "retryable") : undefined;
  if (typeof flagged === "boolean") return flagged;
  return !(error instanceof Error && /too large|larger than|empty|couldn’t be made small/i.test(error.message));
};

export const untilOnline = (): Promise<void> =>
  typeof navigator === "undefined" || navigator.onLine
    ? Promise.resolve()
    : new Promise((resolve) =>
        window.addEventListener("online", () => resolve(), { once: true }),
      );

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const entry of uploads) {
      if (entry.status === "error" && entry.retryable) {
        void uploadOne(entry);
      }
    }
  });
}

export const browserAttachmentUploads = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => uploads,
  add(files: readonly File[]) {
    const room = Math.max(
      0,
      BROWSER_ATTACHMENT_MAX_FILES -
        uploads.filter((entry) => entry.sentWith === null).length,
    );
    for (const file of files.slice(0, room)) {
      const id = `upload-${crypto.randomUUID()}`;
      const error = rejectReason(file);
      const entry: BrowserAttachmentUpload = {
        id,
        file,
        name: file.name,
        sizeBytes: file.size,
        path: null,
        previewUrl: attachmentContentType({
          declared: file.type,
          name: file.name,
        }).startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
        progress: 0,
        status: error ? "error" : "pending",
        error,
        sentWith: null,
        retryable: false,
      };
      uploads = [...uploads, entry];
      notify();
      if (entry.status === "pending") void uploadOne(entry);
      if (
        attachmentContentType({ declared: file.type, name: file.name }).startsWith(
          "video/",
        )
      ) {
        void videoPosterUrl(file).then((previewUrl) => {
          if (!previewUrl) return;
          if (!uploads.some((upload) => upload.id === id)) {
            URL.revokeObjectURL(previewUrl);
            return;
          }
          replace(id, { previewUrl, poster: true });
        });
      }
    }
  },
  retry(id: string) {
    const entry = uploads.find((upload) => upload.id === id);
    if (entry?.status !== "error" || rejectReason(entry.file)) return;
    replace(id, { status: "pending", error: null });
    void uploadOne(entry);
  },
  /** The composer's uploads, handed to a message that was just sent; they keep uploading. */
  takeForMessage(clientMsgId: string): string[] {
    const taken = uploads.filter((entry) => entry.sentWith === null);
    if (taken.length === 0) return [];
    for (const entry of taken) {
      if (entry.status === "error" && !rejectReason(entry.file)) {
        replace(entry.id, { status: "pending", error: null });
        void uploadOne(entry);
      }
    }
    uploads = uploads.map((entry) =>
      entry.sentWith === null ? { ...entry, sentWith: clientMsgId } : entry,
    );
    notify();
    return taken.map((entry) => entry.id);
  },
  find: (id: string) => uploads.find((entry) => entry.id === id) ?? null,
  remove(id: string) {
    const entry = uploads.find((upload) => upload.id === id);
    activeRequests.get(id)?.abort();
    if (entry) revokePreview(entry);
    uploads = uploads.filter((upload) => upload.id !== id);
    notify();
  },
  /** Forget a sent message's uploads once the cloud has its own copy of the message. */
  release(ids: readonly string[]) {
    const released = new Set(ids);
    const gone = uploads.filter((entry) => released.has(entry.id));
    if (gone.length === 0) return;
    uploads = uploads.filter((entry) => !released.has(entry.id));
    notify();
    setTimeout(() => gone.forEach(revokePreview), PREVIEW_RELEASE_DELAY_MS);
  },
};

const PREVIEW_RELEASE_DELAY_MS = 60_000;

export const hasUnsentBrowserAttachments = (): boolean =>
  uploads.some((entry) => entry.sentWith === null);

export const useHasUnsentBrowserAttachments = (): boolean =>
  useSyncExternalStore(
    browserAttachmentUploads.subscribe,
    hasUnsentBrowserAttachments,
    () => false,
  );

const EMPTY: readonly BrowserAttachmentUpload[] = [];
export const useBrowserAttachmentUploads = () =>
  useSyncExternalStore(
    browserAttachmentUploads.subscribe,
    browserAttachmentUploads.getSnapshot,
    () => EMPTY,
  );

