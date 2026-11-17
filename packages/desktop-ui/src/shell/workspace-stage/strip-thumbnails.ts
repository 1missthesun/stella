import { useEffect, useState } from "react";
import { useOptionalUiState } from "@/context/ui-state";
import { localMediaUrl } from "@/shared/hooks/local-media-url";
import { readDisplayFileOnce } from "@/shared/hooks/use-display-file-data";

/**
 * Small pictures for the viewer's strip. A strip item used to load the
 * whole original (a full read and a full-size decode per photo, a whole
 * video pipeline per clip) every time the viewer opened, which held up the
 * file being opened. Each thumbnail is now made once, a few at a time and
 * after the open has had its moment, then kept for the session.
 */

const EDGE_PX = 120;
const ENCODE_TYPE = "image/webp";
const ENCODE_QUALITY = 0.82;
const MAX_KEPT = 600;
const RUNNING_AT_ONCE = 2;
/** Thumbnails wait this long, so the file being opened goes first. */
const START_DELAY_MS = 260;
const VIDEO_TIMEOUT_MS = 10_000;

export type StripThumbKind = "image" | "video";

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

const imageThumb = async (
  filePath: string,
  conversationId: string | null,
): Promise<string | null> => {
  const file = await readDisplayFileOnce(filePath, conversationId);
  if (file.missing) return null;
  const bytes = file.bytes;
  const blob = new Blob(
    [bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes)],
    { type: file.mimeType || "application/octet-stream" },
  );
  // Decoded off the main thread, straight to about the size it's drawn at.
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
  // Wide pictures: size by height instead so the crop isn't blurry.
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

const videoThumb = async (filePath: string): Promise<string | null> => {
  const video = document.createElement("video");
  // The media scheme answers CORS for the app, so the frame can be read back.
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = localMediaUrl(filePath);
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

const notify = (thumb: Thumb) => {
  for (const listener of [...thumb.listeners]) listener();
};

const forgetOldest = () => {
  for (const [key, thumb] of thumbs) {
    if (thumbs.size <= MAX_KEPT) return;
    if (!thumb.done || thumb.listeners.size > 0) continue;
    if (thumb.url) URL.revokeObjectURL(thumb.url);
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
    // Newest asks first: what the strip is showing right now.
    const job = queue.pop();
    if (!job) return;
    const thumb = thumbs.get(job.key);
    if (!thumb || thumb.done || thumb.listeners.size === 0) {
      // Nobody is looking any more; ask again when someone is.
      if (thumb && !thumb.done) thumbs.delete(job.key);
      continue;
    }
    running += 1;
    void job
      .run()
      .catch(() => null)
      .then((url) => {
        running -= 1;
        thumb.url = url;
        thumb.done = true;
        notify(thumb);
        forgetOldest();
        pump();
      });
  }
};

/** Hold thumbnail work back for a moment: something bigger is loading. */
export const deferStripThumbnails = () => {
  delayUntil = performance.now() + START_DELAY_MS;
};

const request = (
  kind: StripThumbKind,
  filePath: string,
  conversationId: string | null,
): Thumb => {
  const key = keyOf(kind, filePath);
  const existing = thumbs.get(key);
  if (existing) {
    // Most recently used last, so the oldest go first.
    thumbs.delete(key);
    thumbs.set(key, existing);
    return existing;
  }
  const thumb: Thumb = { url: null, done: false, listeners: new Set() };
  thumbs.set(key, thumb);
  queue.push({
    key,
    run: () =>
      kind === "image" ? imageThumb(filePath, conversationId) : videoThumb(filePath),
  });
  queueMicrotask(pump);
  return thumb;
};

/** The thumbnail's URL once it is made (null until then, or if it can't be). */
export const useStripThumbnail = (
  kind: StripThumbKind,
  filePath: string,
  wanted: boolean,
): string | null => {
  const conversationId = useOptionalUiState()?.state.conversationId ?? null;
  const [url, setUrl] = useState<string | null>(() => {
    const thumb = thumbs.get(keyOf(kind, filePath));
    return thumb?.done ? thumb.url : null;
  });
  useEffect(() => {
    if (!wanted) return;
    const thumb = request(kind, filePath, conversationId);
    const update = () => setUrl(thumb.done ? thumb.url : null);
    thumb.listeners.add(update);
    update();
    return () => {
      thumb.listeners.delete(update);
    };
  }, [conversationId, filePath, kind, wanted]);
  return url;
};
