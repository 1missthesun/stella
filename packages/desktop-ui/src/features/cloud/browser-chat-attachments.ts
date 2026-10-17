import { useSyncExternalStore } from "react";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_EDGE,
  CHAT_IMAGE_PASSTHROUGH_TYPES,
} from "@stella/contracts/chat-image-limits";
import { backendClient } from "@/platform/backend/backend-client";
import { cloudAttachmentsStore } from "./cloud-composer-store";
import {
  RequestTimeoutError,
  retryIdempotent,
  transferBudgetMs,
} from "@stella/contracts/request-deadline";

export const BROWSER_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
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

const IN_FLIGHT: ReadonlySet<BrowserAttachmentUpload["status"]> = new Set([
  "pending",
  "uploading",
  "finalizing",
]);

const waitForUploadChange = (): Promise<void> =>
  new Promise((resolve) => {
    const listener = () => {
      listeners.delete(listener);
      resolve();
    };
    listeners.add(listener);
  });

export const waitForCloudAttachmentUploads = async (): Promise<void> => {
  while (uploads.some((entry) => IN_FLIGHT.has(entry.status))) {
    await waitForUploadChange();
  }
  const failed = uploads.find((entry) => entry.status === "error");
  if (failed)
    throw new Error(failed.error || `Couldn’t upload ${failed.name}.`);
};

const rejectReason = (file: File): string | null => {
  if (file.size <= 0) return "This file is empty.";
  const isImage = attachmentContentType({
    declared: file.type,
    name: file.name,
  }).startsWith("image/");
  if (isImage && file.size > BROWSER_IMAGE_SOURCE_MAX_BYTES) {
    return "This image is too large to resize safely in the browser.";
  }
  if (!isImage && file.size > BROWSER_ATTACHMENT_MAX_BYTES) {
    return "This file is larger than 20 MB.";
  }
  return null;
};

const safeName = (name: string): string => {
  const boundedCharacters = Array.from(name.normalize("NFKC"), (character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code < 32 || code === 127
      ? "-"
      : character;
  }).join("");
  const cleaned = boundedCharacters
    .replace(/-+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+/g, "")
    .trim();
  return (cleaned || "attachment").slice(0, 180);
};

export const browserAttachmentDrivePath = (
  file: Pick<File, "name">,
  id: string,
  now = new Date(),
): string =>
  `Chat Attachments/${now.toISOString().slice(0, 10)}/${id.slice(-8)}-${safeName(file.name)}`;

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
 * a GIF animated). An image the browser can't decode (HEIC outside Safari)
 * uploads as it is and the cloud fits it instead.
 */
export const fitBrowserChatImage = async (file: File): Promise<File> => {
  const type = attachmentContentType({ declared: file.type, name: file.name });
  if (!type.startsWith("image/") || type === "image/svg+xml") {
    if (file.size > BROWSER_ATTACHMENT_MAX_BYTES) {
      throw new Error("This file is larger than 20 MB.");
    }
    return file;
  }
  if (file.size > BROWSER_IMAGE_SOURCE_MAX_BYTES) {
    throw new Error("This image is too large to resize safely in the browser.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size > BROWSER_ATTACHMENT_MAX_BYTES) {
      throw new Error("This image is larger than 20 MB.");
    }
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

const uploadOne = async (upload: BrowserAttachmentUpload): Promise<void> => {
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
    cloudAttachmentsStore.add({
      path: finalized.path,
      name: finalized.name,
      sizeBytes: finalized.sizeBytes,
      contentType: finalized.contentType,
    });
    replace(upload.id, {
      status: "ready",
      path: finalized.path,
      progress: 1,
      error: null,
    });
  } catch (error) {
    replace(upload.id, {
      status: "error",
      error: error instanceof Error ? error.message : "Upload failed.",
    });
  }
};

export const browserAttachmentUploads = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => uploads,
  add(files: readonly File[]) {
    const room = Math.max(0, BROWSER_ATTACHMENT_MAX_FILES - uploads.length);
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
      };
      uploads = [...uploads, entry];
      notify();
      if (entry.status === "pending") void uploadOne(entry);
    }
  },
  retry(id: string) {
    const entry = uploads.find((upload) => upload.id === id);
    if (entry?.status === "error") void uploadOne(entry);
  },
  remove(id: string) {
    const entry = uploads.find((upload) => upload.id === id);
    activeRequests.get(id)?.abort();
    if (entry?.path) cloudAttachmentsStore.remove(entry.path);
    if (entry) revokePreview(entry);
    uploads = uploads.filter((upload) => upload.id !== id);
    notify();
  },
  clearReady(paths: ReadonlySet<string>) {
    for (const entry of uploads) {
      if (entry.path && paths.has(entry.path) && entry.status === "ready") {
        revokePreview(entry);
      }
    }
    uploads = uploads.filter(
      (entry) =>
        !(entry.path && paths.has(entry.path) && entry.status === "ready"),
    );
    notify();
  },
};

const EMPTY: readonly BrowserAttachmentUpload[] = [];
export const useBrowserAttachmentUploads = () =>
  useSyncExternalStore(
    browserAttachmentUploads.subscribe,
    browserAttachmentUploads.getSnapshot,
    () => EMPTY,
  );

