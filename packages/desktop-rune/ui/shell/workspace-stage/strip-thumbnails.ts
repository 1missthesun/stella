import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { useDriveFileVersion } from "@/features/cloud/drive-file-versions";
import { driveFileLink } from "@/features/cloud/CloudFileSource";

const EDGE_PX = 120;
const MAX_KEPT = 600;
const PAGE_RASTER_TIMEOUT_MS = 10_000;
const RUNNING_AT_ONCE = 2;
const START_DELAY_MS = 260;

export type StripThumbKind = "image" | "video" | "pdf";

type Thumb = { url: string | null; done: boolean; listeners: Set<() => void> };

const thumbs = new Map<string, Thumb>();
const queue: Array<{ key: string; run: () => Promise<string | null> }> = [];
let running = 0;
let delayUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const keyOf = (kind: StripThumbKind, filePath: string) => `${kind}\0${filePath}`;
const driveKeyOf = (kind: StripThumbKind, drivePath: string, version: string) => `drive\0${kind}\0${drivePath}\0${version}`;

/** A video's poster frame, rasterized by main's evidence cards (ffmpeg / Quick Look) off the UI thread. */
const videoThumb = async (filePath: string): Promise<string | null> => {
  const set = await window.electronAPI?.chatEvidence?.cards([filePath]);
  return set?.cards[0]?.thumbnail ?? null;
};

const pageRasterCommand = (filePath: string, dir: string): string[] | null => {
  if (process.platform === "darwin") return ["/usr/bin/qlmanage", "-t", "-s", String(EDGE_PX * 2), "-o", dir, filePath];
  if (process.platform === "linux") return ["pdftoppm", "-png", "-f", "1", "-l", "1", "-scale-to", String(EDGE_PX * 2), filePath, join(dir, "page")];
  return null;
};

/** A PDF's first page, rasterized by the system's own renderer in its own process. */
const pdfThumb = async (filePath: string): Promise<string | null> => {
  const dir = await mkdtemp(join(tmpdir(), "stella-strip-"));
  try {
    const command = pageRasterCommand(filePath, dir);
    if (!command) return null;
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    const timeout = setTimeout(() => child.kill(), PAGE_RASTER_TIMEOUT_MS);
    await child.exited.finally(() => clearTimeout(timeout));
    const produced = (await readdir(dir)).find((name) => name.toLowerCase().endsWith(".png"));
    if (!produced) return null;
    return `data:image/png;base64,${(await readFile(join(dir, produced))).toString("base64")}`;
  } catch {
    return null;
  } finally {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

const driveThumb = async (drivePath: string): Promise<string | null> => {
  const host = window.electronAPI?.chatEvidence;
  if (!host?.driveCards) return null;
  const link = await driveFileLink(drivePath);
  const [card] = await host.driveCards([{ drivePath: link.path, url: link.url, sizeBytes: link.sizeBytes, contentType: link.contentType, version: link.version }]);
  return card?.thumbnail ?? null;
};

const notify = (thumb: Thumb) => {
  for (const listener of [...thumb.listeners]) listener();
};

const forgetOldest = () => {
  for (const [key, thumb] of thumbs) {
    if (thumbs.size <= MAX_KEPT) return;
    if (!thumb.done || thumb.listeners.size > 0) continue;
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

const request = (key: string, run: () => Promise<string | null>): Thumb => {
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

const useThumb = (key: string | null, run: () => Promise<string | null>): string | null => {
  const [shown, setShown] = useState<{ key: string | null; url: string | null }>(() => {
    const thumb = key ? thumbs.get(key) : undefined;
    return { key, url: thumb?.done ? thumb.url : null };
  });
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
  return shown.key === key ? shown.url : null;
};

/** desktop-ui's `useStripThumbnail`; a local image needs none (the engine draws the file itself, cover-cropped). */
export const useStripThumbnail = (kind: StripThumbKind, filePath: string, wanted: boolean): string | null => {
  const local = useThumb(wanted && kind !== "image" ? keyOf(kind, filePath) : null, () => (kind === "pdf" ? pdfThumb(filePath) : videoThumb(filePath)));
  return wanted && kind === "image" ? filePath : local;
};

export const useDriveStripThumbnail = (kind: StripThumbKind, drivePath: string, wanted: boolean): string | null => {
  const version = useDriveFileVersion(wanted ? drivePath : null);
  return useThumb(wanted && version !== null ? driveKeyOf(kind, drivePath, version ?? "") : null, () => driveThumb(drivePath));
};

/** Height over width of a `data:image/png` thumbnail, from its IHDR. */
export const pngAspect = (url: string): number | null => {
  const head = url.startsWith("data:image/png;base64,") ? Buffer.from(url.slice(22, 22 + 44), "base64") : null;
  if (!head || head.length < 24) return null;
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);
  return width > 0 && height > 0 ? height / width : null;
};
