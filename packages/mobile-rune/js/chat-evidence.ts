// The phone's `chatEvidence.driveCards`: the preview cards a reply's Drive pictures, videos and
// pages get under the message (desktop-ui's use-drive-evidence-cards asks for them), which a
// computer makes in Electron (desktop/electron/services/chat-evidence-service.ts) and the RN app
// with its own previews (lib/chat-evidence-previews). Without them the phone showed only pages as
// cards and every picture and video as a pill inside the bubble.
//
// A picture is the file itself, kept on disk (the engine decodes it at the size the card draws);
// a page is the backend's preview image; a video is a frame the app takes natively from the
// file's link (`media.videoPoster`). Each card is kept per Drive version, in memory and on disk,
// so a chat scrolled back to or opened again shows its cards at once.

import type { DriveEvidenceSource, EvidenceCard } from "@stella/contracts/chat-evidence";
import { evidenceSourceKind, formatByteSize, formatDuration, humanTitleFor } from "@stella/contracts/chat-evidence-naming";
import { driveLinkTarget } from "@stella/contracts/cloud-world-paths";
import { isHtmlPagePath } from "@stella/contracts/page-preview";
import { backendClient } from "@/platform/backend/backend-client";
import { phoneRequest } from "../ui/native/app";
import { EVIDENCE_TILE_HEIGHT, EVIDENCE_TILE_WIDTH } from "@stella/contracts/chat-evidence";

const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const CONCURRENCY = 3;
const MAX_KEPT = 400;
const SAVE_AFTER_MS = 1_500;
const INDEX_VERSION = 1;

const folder = () => `${__native.env.caches}/chat-evidence`;
const indexPath = () => `${folder()}/index.json`;

type Kept = Omit<EvidenceCard, "thumbnail"> & { file: string };

let kept: Map<string, Kept> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const inFlight = new Map<string, Promise<EvidenceCard | null>>();

const keptCards = (): Map<string, Kept> => {
  if (kept) return kept;
  kept = new Map();
  try {
    const parsed = JSON.parse(__native.readText(indexPath()) ?? "{}") as { version?: number; entries?: [string, Kept][] };
    if (parsed.version === INDEX_VERSION && Array.isArray(parsed.entries)) for (const [key, card] of parsed.entries) kept.set(key, card);
  } catch {}
  return kept;
};

const save = () => {
  saveTimer = null;
  __native.writeFile(indexPath(), JSON.stringify({ version: INDEX_VERSION, entries: [...keptCards()] }));
};

const keep = (key: string, card: EvidenceCard) => {
  const cards = keptCards();
  const { thumbnail, ...rest } = card;
  if (!thumbnail) return;
  cards.delete(key);
  cards.set(key, { ...rest, file: thumbnail.slice(thumbnail.lastIndexOf("/") + 1) });
  while (cards.size > MAX_KEPT) {
    const [oldest, card] = cards.entries().next().value as [string, Kept];
    cards.delete(oldest);
    __native.removeFile(`${folder()}/${card.file}`);
  }
  saveTimer ??= setTimeout(save, SAVE_AFTER_MS);
};

const restored = (card: Kept): EvidenceCard | null => {
  const path = `${folder()}/${card.file}`;
  const { file: _file, ...rest } = card;
  return __native.readFile(path) ? { ...rest, thumbnail: path } : null;
};

const fileName = (key: string, extension: string) => {
  const digest = __native.digest("SHA-256", new TextEncoder().encode(key));
  let hex = "";
  for (let i = 0; i < 12; i++) hex += digest[i]!.toString(16).padStart(2, "0");
  return `${folder()}/${hex}.${extension}`;
};

const download = async (url: string, out: string, maxBytes: number): Promise<boolean> => {
  const response = await fetch(url);
  if (!response.ok) return false;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.byteLength > 0 && bytes.byteLength <= maxBytes && __native.writeFile(out, bytes);
};

const extensionOf = (path: string) => {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "img";
};

const build = async (key: string, file: DriveEvidenceSource): Promise<EvidenceCard | null> => {
  const kind = evidenceSourceKind(file.drivePath, false);
  const base = {
    id: `drive:${key}`,
    title: humanTitleFor(file.drivePath, kind),
    sourcePaths: [driveLinkTarget(file.drivePath)],
    byteSize: file.sizeBytes,
  };
  if (kind === "image") {
    if (file.sizeBytes > IMAGE_MAX_BYTES) return null;
    const out = fileName(key, extensionOf(file.drivePath));
    if (!(await download(file.url, out, IMAGE_MAX_BYTES))) return null;
    return { ...base, kind: "image", thumbnail: out, subtitle: formatByteSize(file.sizeBytes) };
  }
  if (kind === "page" && isHtmlPagePath(file.drivePath)) {
    const preview = await backendClient.call("drive.pagePreview", { path: file.drivePath });
    const out = fileName(key, "jpg");
    if (!(await download(preview.url, out, IMAGE_MAX_BYTES))) return null;
    return { ...base, kind: "page", thumbnail: out, subtitle: formatByteSize(file.sizeBytes) };
  }
  if (kind === "video") {
    const poster = await phoneRequest<{ path: string; durationMs: number }>("media.videoPoster", {
      url: file.url,
      out: fileName(key, "jpg"),
      width: EVIDENCE_TILE_WIDTH.video,
      height: EVIDENCE_TILE_HEIGHT,
    });
    return {
      ...base,
      kind: "video",
      thumbnail: poster.path,
      ...(poster.durationMs > 0 ? { durationMs: poster.durationMs, subtitle: formatDuration(poster.durationMs) } : {}),
    };
  }
  return null;
};

let running = 0;
const waiting: (() => void)[] = [];
const limited = async <T>(work: () => Promise<T>): Promise<T> => {
  if (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
};

const cardFor = (file: DriveEvidenceSource): Promise<EvidenceCard | null> => {
  const key = `${file.drivePath}\u0000${file.version}`;
  const known = keptCards().get(key);
  const card = known && restored(known);
  if (card) return Promise.resolve(card);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = limited(() => build(key, file))
    .catch(() => null)
    .then((made) => {
      if (made) keep(key, made);
      return made;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, work);
  return work;
};

export const phoneChatEvidence = {
  async driveCards(files: DriveEvidenceSource[]): Promise<EvidenceCard[]> {
    const unique = files.filter((file, index) => files.findIndex((other) => other.drivePath === file.drivePath) === index);
    const cards = await Promise.all(unique.map(cardFor));
    return cards.filter((card): card is EvidenceCard => card !== null);
  },
};
