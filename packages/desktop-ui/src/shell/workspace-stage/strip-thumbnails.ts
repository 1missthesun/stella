import { useEffect, useRef, useState } from "react";
import { useOptionalUiState } from "@/context/ui-state";
import { localMediaUrl } from "@/shared/hooks/local-media-url";
import { readDisplayFileOnce } from "@/shared/hooks/use-display-file-data";
import { useDriveFileVersion } from "@/features/cloud/drive-file-versions";
import { driveFileLink, readDriveFile } from "@/features/cloud/CloudFileSource";

const EDGE_PX = 120;
const ENCODE_TYPE = "image/webp";
const ENCODE_QUALITY = 0.82;
const MAX_KEPT = 600;
const RUNNING_AT_ONCE = 2;
const START_DELAY_MS = 260;
const VIDEO_TIMEOUT_MS = 10_000;
const DRIVE_IMAGE_MAX_BYTES = 40 * 1024 * 1024;
const PDF_MAX_BYTES = 64 * 1024 * 1024;

export type StripThumbKind = "image" | "video" | "pdf";

type Thumb = {
  url: string | null;
  done: boolean;
  listeners: Set<() => void>;
};

// @reloadable a cache of small pictures; a newer copy makes them again
const thumbs = new Map<string, Thumb>();
const queue: Array<{ key: string; run: () => Promise<string | null> }> = [];
let running = 0;
let delayUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (kind: StripThumbKind, filePath: string) => `${kind}\0${filePath}`;
const driveKeyOf = (kind: StripThumbKind, drivePath: string, version: string) =>
  `drive\0${kind}\0${drivePath}\0${version}`;

const coverCrop = async (
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<string | null> => {
  if (!(width > 0) || !(height > 0)) return null;
  const canvas = new OffscreenCanvas(EDGE_PX, EDGE_PX);
  const context = canvas.getContext("2d");
  if (!context) return null;
  const scale = Math.max(EDGE_PX / width, EDGE_PX / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source,
    (EDGE_PX - drawWidth) / 2,
    (EDGE_PX - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  const blob = await canvas.convertToBlob({
    type: ENCODE_TYPE,
    quality: ENCODE_QUALITY,
  });
  return URL.createObjectURL(blob);
};

const blobOf = (bytes: Uint8Array, mimeType: string): Blob =>
  new Blob(
    [bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes)],
    { type: mimeType || "application/octet-stream" },
  );

const imageThumb = async (
  filePath: string,
  conversationId: string | null,
): Promise<string | null> => {
  const file = await readDisplayFileOnce(filePath, conversationId);
  if (file.missing) return null;
  return await imageThumbOf(blobOf(file.bytes, file.mimeType));
};

const imageThumbOf = async (blob: Blob): Promise<string | null> => {
  const probe = await createImageBitmap(blob, {
    resizeWidth: EDGE_PX * 2,
    resizeQuality: "medium",
  });
  try {
    if (probe.height >= EDGE_PX) {
      return await coverCrop(probe, probe.width, probe.height);
    }
  } finally {
    probe.close();
  }
  const wide = await createImageBitmap(blob, {
    resizeHeight: EDGE_PX,
    resizeQuality: "medium",
  });
  try {
    return await coverCrop(wide, wide.width, wide.height);
  } finally {
    wide.close();
  }
};

const once = (
  target: HTMLMediaElement,
  events: string[],
  timeoutMs: number,
): Promise<boolean> =>
  new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timeout);
      for (const name of events) target.removeEventListener(name, onEvent);
      target.removeEventListener("error", onError);
      resolve(ok);
    };
    const onEvent = () => finish(true);
    const onError = () => finish(false);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    for (const name of events) target.addEventListener(name, onEvent);
    target.addEventListener("error", onError);
  });

const videoThumb = async (src: string): Promise<string | null> => {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = src;
  try {
    if (!(await once(video, ["loadedmetadata"], VIDEO_TIMEOUT_MS))) return null;
    const at = Number.isFinite(video.duration)
      ? Math.min(0.5, video.duration / 2)
      : 0;
    if (at > 0) {
      const seeked = once(video, ["seeked"], VIDEO_TIMEOUT_MS);
      video.currentTime = at;
      if (!(await seeked)) return null;
    } else if (video.readyState < 2) {
      if (!(await once(video, ["loadeddata"], VIDEO_TIMEOUT_MS))) return null;
    }
    return await coverCrop(video, video.videoWidth, video.videoHeight);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
};

const pdfThumbOf = async (bytes: Uint8Array): Promise<string | null> => {
  const { pdfjs } = await import("react-pdf");
  const worker = `${import.meta.env.BASE_URL}vendor/pdfjs/pdf.worker.min.mjs`;
  if (pdfjs.GlobalWorkerOptions.workerSrc !== worker) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = (EDGE_PX * 2) / Math.max(1, Math.min(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const side = Math.min(canvas.width, canvas.height);
    const top = new OffscreenCanvas(side, side);
    top.getContext("2d")?.drawImage(canvas, (canvas.width - side) / 2, 0, side, side, 0, 0, side, side);
    return await coverCrop(top, side, side);
  } finally {
    void task.destroy();
  }
};

const pdfThumb = async (
  filePath: string,
  conversationId: string | null,
): Promise<string | null> => {
  const file = await readDisplayFileOnce(filePath, conversationId);
  if (file.missing) return null;
  return await pdfThumbOf(file.bytes);
};

const driveThumb = async (
  kind: StripThumbKind,
  drivePath: string,
): Promise<string | null> => {
  const link = await driveFileLink(drivePath);
  if (kind === "pdf") {
    if (link.sizeBytes > PDF_MAX_BYTES) return null;
    const read = await readDriveFile(drivePath, PDF_MAX_BYTES);
    return read.truncated ? null : await pdfThumbOf(read.bytes);
  }
  const host = window.electronAPI?.chatEvidence;
  if (host?.driveCards) {
    const [card] = await host.driveCards([
      {
        drivePath: link.path,
        url: link.url,
        sizeBytes: link.sizeBytes,
        contentType: link.contentType,
        version: link.version,
      },
    ]);
    if (card?.thumbnail) return card.thumbnail;
  }
  if (kind === "video") return await videoThumb(link.url);
  if (link.sizeBytes > DRIVE_IMAGE_MAX_BYTES) return null;
  const read = await readDriveFile(drivePath, DRIVE_IMAGE_MAX_BYTES);
  return read.truncated ? null : await imageThumbOf(blobOf(read.bytes, read.mimeType));
};

const notify = (thumb: Thumb) => {
  for (const listener of [...thumb.listeners]) listener();
};

const forgetOldest = () => {
  for (const [key, thumb] of thumbs) {
    if (thumbs.size <= MAX_KEPT) return;
    if (!thumb.done || thumb.listeners.size > 0) continue;
    if (thumb.url?.startsWith("blob:")) URL.revokeObjectURL(thumb.url);
    thumbs.delete(key);
  }
};

const pump = () => {
  if (timer) return;
  const wait = delayUntil - performance.now();
  if (wait > 0) {
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, wait);
    return;
  }
  while (running < RUNNING_AT_ONCE) {
    const job = queue.pop();
    if (!job) return;
    const thumb = thumbs.get(job.key);
    if (!thumb || thumb.done || thumb.listeners.size === 0) {
      if (thumb && !thumb.done) thumbs.delete(job.key);
      continue;
    }
    running += 1;
    void job
      .run()
      .then(
        (url) => ({ url, failed: false }),
        () => ({ url: null, failed: true }),
      )
      .then(({ url, failed }) => {
        running -= 1;
        thumb.url = url;
        thumb.done = true;
        if (failed && thumbs.get(job.key) === thumb) thumbs.delete(job.key);
        notify(thumb);
        forgetOldest();
        pump();
      });
  }
};

export const deferStripThumbnails = () => {
  delayUntil = performance.now() + START_DELAY_MS;
};

const request = (
  key: string,
  run: () => Promise<string | null>,
): Thumb => {
  const existing = thumbs.get(key);
  if (existing) {
    thumbs.delete(key);
    thumbs.set(key, existing);
    return existing;
  }
  const thumb: Thumb = { url: null, done: false, listeners: new Set() };
  thumbs.set(key, thumb);
  queue.push({ key, run });
  queueMicrotask(pump);
  return thumb;
};

const useThumb = (
  key: string | null,
  run: () => Promise<string | null>,
): string | null => {
  const [shown, setShown] = useState<{ key: string | null; url: string | null }>(
    () => {
      const thumb = key ? thumbs.get(key) : undefined;
      return { key, url: thumb?.done ? thumb.url : null };
    },
  );
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!key) return;
    const thumb = request(key, () => runRef.current());
    const update = () => {
      if (thumb.done) setShown({ key, url: thumb.url });
    };
    thumb.listeners.add(update);
    update();
    return () => {
      thumb.listeners.delete(update);
    };
  }, [key]);
  return shown.url;
};

export const useStripThumbnail = (
  kind: StripThumbKind,
  filePath: string,
  wanted: boolean,
): string | null => {
  const conversationId = useOptionalUiState()?.state.conversationId ?? null;
  return useThumb(
    wanted ? keyOf(kind, filePath) : null,
    () =>
      kind === "image"
        ? imageThumb(filePath, conversationId)
        : kind === "pdf"
          ? pdfThumb(filePath, conversationId)
          : videoThumb(localMediaUrl(filePath)),
  );
};

export const useDriveStripThumbnail = (
  kind: StripThumbKind,
  drivePath: string,
  wanted: boolean,
): string | null => {
  const version = useDriveFileVersion(wanted ? drivePath : null);
  return useThumb(
    wanted && version !== null
      ? driveKeyOf(kind, drivePath, version ?? "")
      : null,
    () => driveThumb(kind, drivePath),
  );
};
