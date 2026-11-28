import { useEffect, useSyncExternalStore } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import type { ThumbnailKind } from "./model";

// packages/mobile's file-thumbnails in Rune: a Drive file's picture, page preview or opening text,
// fetched once per version into the app's caches and kept across launches. Pictures are files on
// disk so the engine decodes them at the size they are drawn (`<image src={path} w>`), never at
// full size on a tile.

export type Thumbnail = { kind: "image"; path: string } | { kind: "text"; text: string };
export type ThumbnailState = { status: "pending" } | { status: "ready"; thumbnail: Thumbnail } | { status: "none" };

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const TEXT_BYTES = 8 * 1024;
const TEXT_CHARS = 1_600;
const CONCURRENCY = 3;
const RETRY_AFTER_MS = 60_000;
const MAX_KEPT = 600;
const SAVE_AFTER_MS = 1_500;
const INDEX_VERSION = 2;

const PENDING: ThumbnailState = { status: "pending" };
const NONE: ThumbnailState = { status: "none" };

const folder = () => `${__native.env.caches}/file-thumbnails`;
const indexPath = () => `${folder()}/index.json`;

type Stored = { kind: "image"; file: string } | { kind: "text"; text: string };
type Kept = { version: number; thumbnail: Stored };

let kept: Map<string, Kept> | null = null;
const states = new Map<string, ThumbnailState>();
const failed = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
const queue: { id: string; version: number; run: () => Promise<Thumbnail | null> }[] = [];
const running = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const keptEntries = (): Map<string, Kept> => {
  if (kept) return kept;
  kept = new Map();
  try {
    const parsed = JSON.parse(__native.readText(indexPath()) ?? "{}") as { version?: number; entries?: [string, Kept][] };
    if (parsed.version === INDEX_VERSION && Array.isArray(parsed.entries)) for (const [id, entry] of parsed.entries) kept.set(id, entry);
  } catch {}
  return kept;
};

const save = () => {
  saveTimer = null;
  __native.writeFile(indexPath(), JSON.stringify({ version: INDEX_VERSION, entries: [...keptEntries()] }));
};

const stored = (thumbnail: Thumbnail): Stored =>
  thumbnail.kind === "image" ? { kind: "image", file: thumbnail.path.slice(thumbnail.path.lastIndexOf("/") + 1) } : thumbnail;

const restored = (thumbnail: Stored): Thumbnail => (thumbnail.kind === "image" ? { kind: "image", path: `${folder()}/${thumbnail.file}` } : thumbnail);

const keep = (id: string, version: number, thumbnail: Thumbnail) => {
  const entries = keptEntries();
  entries.delete(id);
  entries.set(id, { version, thumbnail: stored(thumbnail) });
  while (entries.size > MAX_KEPT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  saveTimer ??= setTimeout(save, SAVE_AFTER_MS);
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

const publish = (id: string, state: ThumbnailState) => {
  states.set(id, state);
  for (const listener of listeners.get(id) ?? []) listener();
};

const download = async (url: string, id: string, version: number, extension: string): Promise<Thumbnail | null> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const path = `${folder()}/${hashOf(`${id}|${version}`)}.${extension}`;
  if (!__native.writeFile(path, bytes)) return null;
  return { kind: "image", path };
};

const load = async (kind: ThumbnailKind, drivePath: string, id: string, version: number, extension: string): Promise<Thumbnail | null> => {
  if (kind === "image") {
    const { url } = await backendClient.call("drive.fileUrl", { path: drivePath });
    return await download(url, id, version, extension || "img");
  }
  if (kind === "html") {
    const preview = await backendClient.call("drive.pagePreview", { path: drivePath, shape: "page" }).catch(() => backendClient.call("drive.pagePreview", { path: drivePath }));
    return await download(preview.url, id, version, "jpg");
  }
  if (kind === "text") {
    const { url } = await backendClient.call("drive.fileUrl", { path: drivePath });
    const response = await fetch(url, { headers: { Range: `bytes=0-${TEXT_BYTES - 1}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return { kind: "text", text: text.slice(0, TEXT_CHARS) };
  }
  return null;
};

const pump = () => {
  while (running.size < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running.add(job.id);
    void job
      .run()
      .then((thumbnail) => {
        if (!thumbnail) return publish(job.id, NONE);
        keep(job.id, job.version, thumbnail);
        publish(job.id, { status: "ready", thumbnail });
      })
      .catch(() => {
        failed.set(job.id, Date.now());
        publish(job.id, NONE);
      })
      .finally(() => {
        running.delete(job.id);
        pump();
      });
  }
};

const request = (kind: ThumbnailKind, drivePath: string, version: number, extension: string) => {
  const id = `${kind}|${drivePath}`;
  if (running.has(id) || queue.some((job) => job.id === id)) return;
  const known = keptEntries().get(id);
  if (known && known.version === version) {
    if (states.get(id)?.status !== "ready") publish(id, { status: "ready", thumbnail: restored(known.thumbnail) });
    return;
  }
  const state = states.get(id);
  if (state?.status === "ready" && known?.version === version) return;
  const failedAt = failed.get(id);
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return;
  failed.delete(id);
  queue.push({ id, version, run: () => load(kind, drivePath, id, version, extension) });
  pump();
};

const subscribe = (id: string) => (listener: () => void) => {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(id);
  };
};

const subscribers = new Map<string, (listener: () => void) => () => void>();
const subscriberFor = (id: string) => {
  let fn = subscribers.get(id);
  if (!fn) subscribers.set(id, (fn = subscribe(id)));
  return fn;
};

const stateOf = (id: string, version: number): ThumbnailState => {
  const state = states.get(id);
  if (state) return state;
  const known = keptEntries().get(id);
  if (known && known.version === version) {
    const ready: ThumbnailState = { status: "ready", thumbnail: restored(known.thumbnail) };
    states.set(id, ready);
    return ready;
  }
  return PENDING;
};

/**
 * A Drive file's thumbnail. It loads once `wanted` (the file's row is near the screen), and what
 * loaded before shows at once, so a tile scrolled back to never flashes empty.
 */
export function useFileThumbnail(kind: ThumbnailKind, drivePath: string, version: number, extension: string, wanted: boolean): ThumbnailState {
  const id = `${kind}|${drivePath}`;
  const loadable = kind === "image" || kind === "html" || kind === "text";
  const state = useSyncExternalStore(subscriberFor(id), () => (loadable && drivePath ? stateOf(id, version) : NONE));
  useEffect(() => {
    if (!loadable || !drivePath || !wanted) return;
    request(kind, drivePath, version, extension);
  }, [drivePath, extension, kind, loadable, version, wanted]);
  return state;
}
