import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  EVIDENCE_CARD_CAP,
  EVIDENCE_RASTER_SCALE,
  EVIDENCE_TILE_HEIGHT,
  EVIDENCE_TILE_WIDTH,
  type EvidenceCard,
  type EvidenceCardKind,
  type DriveEvidenceSource,
  type EvidenceCardSet,
} from "@stella/contracts/chat-evidence";
import os from "node:os";
import type { PeerDeviceFiles } from "./peer-device-files.js";
import { deviceFileReadRanges } from "@stella/contracts/device-file-reads";
import { nativeImage } from "electron";
import {
  archiveEntryExtensions,
  extractAudioPeaks,
  folderEntryExtensions,
  imageDimensions,
  probeDurationMs,
  probePageCount,
  rasterizeImageFile,
  readTablePreview,
  remoteVideoPoster,
  videoPosterRaster,
  coverCropToDataUrl,
} from "./chat-evidence-media.js";
import {
  describeComposition,
  evidenceSourceKind,
  formatByteSize,
  formatDuration,
  humanTitleFor,
  plainKindLabel,
  playbackMimeTypeFor,
  stackTitleFor,
  type EvidenceSourceKind,
} from "@stella/contracts/chat-evidence-naming";
import {
  cloudWorldDrivePath,
  driveLinkPath,
  driveLinkTarget,
} from "@stella/contracts/cloud-world-paths";
import {
  fetchWithInactivity,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

const CACHE_DIRNAME = "chat-evidence";
const CACHE_SCHEMA = "v1";
const FULL_HASH_CAP_BYTES = 48 * 1024 * 1024;
const SAMPLE_BYTES = 1024 * 1024;
const STACK_FRAME_CAP = 8;
const DRIVE_IMAGE_MAX_BYTES = 40 * 1024 * 1024;
const DRIVE_VIDEO_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;
const GENERATION_CONCURRENCY = 3;

type SourceEntry = {
  filePath: string;
  kind: EvidenceSourceKind;
  byteSize: number;
  isDirectory: boolean;
  order: number;
  elsewhere?: boolean;
  holder?: { deviceId: string; modifiedAt: number };
};

const PEER_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const PEER_VIDEO_HEAD_BYTES = 8 * 1024 * 1024;

type CardPlan =
  | { kind: "single"; entry: SourceEntry }
  | { kind: "stack"; entries: SourceEntry[]; sourceKind: EvidenceSourceKind };

const boxFor = (cardKind: EvidenceCardKind) => ({
  width: EVIDENCE_TILE_WIDTH[cardKind] * EVIDENCE_RASTER_SCALE,
  height: EVIDENCE_TILE_HEIGHT * EVIDENCE_RASTER_SCALE,
});

const hashWholeFile = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });

const hashSampled = async (
  filePath: string,
  byteSize: number,
  mtimeMs: number,
): Promise<string> => {
  const hash = createHash("sha256");
  hash.update(`${byteSize}:${Math.round(mtimeMs)}`);
  const handle = await fs.open(filePath, "r");
  try {
    const head = Buffer.alloc(SAMPLE_BYTES);
    const headRead = await handle.read(head, 0, SAMPLE_BYTES, 0);
    hash.update(head.subarray(0, headRead.bytesRead));
    const tailStart = Math.max(0, byteSize - SAMPLE_BYTES);
    const tail = Buffer.alloc(SAMPLE_BYTES);
    const tailRead = await handle.read(tail, 0, SAMPLE_BYTES, tailStart);
    hash.update(tail.subarray(0, tailRead.bytesRead));
  } finally {
    await handle.close().catch(() => undefined);
  }
  return hash.digest("hex");
};

const contentHash = async (
  filePath: string,
  byteSize: number,
  mtimeMs: number,
  isDirectory: boolean,
): Promise<string> => {
  if (isDirectory) {
    return createHash("sha256")
      .update(`dir:${filePath}:${Math.round(mtimeMs)}`)
      .digest("hex");
  }
  if (byteSize <= FULL_HASH_CAP_BYTES) return await hashWholeFile(filePath);
  return await hashSampled(filePath, byteSize, mtimeMs);
};

const describeSource = async (
  filePath: string,
  order: number,
): Promise<SourceEntry | null> => {
  try {
    const stats = await fs.stat(filePath);
    const isDirectory = stats.isDirectory();
    if (!isDirectory && !stats.isFile()) return null;
    return {
      filePath,
      kind: evidenceSourceKind(filePath, isDirectory),
      byteSize: isDirectory ? 0 : stats.size,
      isDirectory,
      order,
    };
  } catch {
    return null;
  }
};

const planCards = (entries: SourceEntry[]): CardPlan[] => {
  const plans: CardPlan[] = [];
  for (const entry of entries) {
    plans.push({ kind: "single", entry });
  }

  const orderOf = (plan: CardPlan): number => {
    if (plan.kind === "single") return plan.entry.order;
    return Math.min(...plan.entries.map((entry) => entry.order));
  };
  return plans.sort((left, right) => orderOf(left) - orderOf(right));
};

const cardKindForSource = (sourceKind: EvidenceSourceKind): EvidenceCardKind => {
  if (sourceKind === "image") return "image";
  if (sourceKind === "video") return "video";
  if (sourceKind === "audio") return "audio";
  if (sourceKind === "page") return "page";
  if (sourceKind === "pdf" || sourceKind === "office") return "document";
  if (sourceKind === "table") return "table";
  if (sourceKind === "bundle" || sourceKind === "folder") return "bundle";
  return "plain";
};

const planCacheKey = async (plan: CardPlan): Promise<string> => {
  const hashOne = async (entry: SourceEntry): Promise<string> => {
    const stats = await fs.stat(entry.filePath).catch(() => null);
    return await contentHash(
      entry.filePath,
      entry.byteSize,
      stats?.mtimeMs ?? 0,
      entry.isDirectory,
    );
  };
  if (plan.kind === "single") {
    return `${CACHE_SCHEMA}:single:${plan.entry.kind}:${await hashOne(plan.entry)}`;
  }
  const hashes = await Promise.all(plan.entries.map(hashOne));
  return `${CACHE_SCHEMA}:stack:${plan.sourceKind}:${hashes.sort().join(",")}`;
};

const plainCard = (id: string, entry: SourceEntry): EvidenceCard => ({
  id,
  kind: "plain",
  title: humanTitleFor(entry.filePath, entry.kind),
  subtitle: `${plainKindLabel(entry.filePath)} · ${formatByteSize(entry.byteSize)}`,
  sourcePaths: [entry.filePath],
  byteSize: entry.byteSize,
  extensionLabel: plainKindLabel(entry.filePath),
});

const elsewhereCard = (entry: SourceEntry): EvidenceCard => ({
  id: `elsewhere:${createHash("sha1").update(entry.filePath).digest("hex").slice(0, 32)}`,
  kind:
    entry.kind === "page" || entry.kind === "table"
      ? entry.kind
      : entry.kind === "bundle" || entry.kind === "folder"
        ? "bundle"
        : "plain",
  title: humanTitleFor(entry.filePath, entry.kind),
  subtitle: plainKindLabel(entry.filePath),
  sourcePaths: [entry.filePath],
  extensionLabel: plainKindLabel(entry.filePath),
});

const buildSingleCard = async (
  id: string,
  entry: SourceEntry,
): Promise<EvidenceCard> => {
  const cardKind = cardKindForSource(entry.kind);
  const box = boxFor(cardKind);
  const base = {
    id,
    title: humanTitleFor(entry.filePath, entry.kind),
    sourcePaths: [entry.filePath],
    byteSize: entry.byteSize,
  };

  if (entry.kind === "image") {
    const thumbnail = await rasterizeImageFile(entry.filePath, box.width, box.height);
    if (!thumbnail) return plainCard(id, entry);
    const dimensions = await imageDimensions(entry.filePath);
    return {
      ...base,
      kind: "image",
      thumbnail,
      subtitle: dimensions
        ? `${dimensions.width} × ${dimensions.height}`
        : formatByteSize(entry.byteSize),
    };
  }

  if (entry.kind === "video") {
    const [thumbnail, durationMs] = await Promise.all([
      videoPosterRaster(entry.filePath, box.width, box.height),
      probeDurationMs(entry.filePath),
    ]);
    if (!thumbnail) return plainCard(id, entry);
    return {
      ...base,
      kind: "video",
      thumbnail,
      ...(durationMs ? { durationMs, subtitle: formatDuration(durationMs) } : {}),
      ...(playbackMimeTypeFor(entry.filePath)
        ? { playbackMimeType: playbackMimeTypeFor(entry.filePath) }
        : {}),
    };
  }

  if (entry.kind === "audio") {
    const extracted = await extractAudioPeaks(entry.filePath);
    if (!extracted) return plainCard(id, entry);
    const durationMs = extracted.durationMs ?? (await probeDurationMs(entry.filePath));
    return {
      ...base,
      kind: "audio",
      peaks: extracted.peaks,
      ...(durationMs ? { durationMs, subtitle: formatDuration(durationMs) } : {}),
      ...(playbackMimeTypeFor(entry.filePath)
        ? { playbackMimeType: playbackMimeTypeFor(entry.filePath) }
        : {}),
    };
  }

  if (entry.kind === "page") {
    return {
      ...base,
      kind: "page",
      subtitle: formatByteSize(entry.byteSize),
    };
  }

  if (entry.kind === "pdf" || entry.kind === "office") {
    const pageCount = await probePageCount(entry.filePath);
    return {
      ...base,
      kind: "document",
      ...(pageCount ? { pageCount } : {}),
      subtitle: pageCount
        ? `${pageCount} ${pageCount === 1 ? "page" : "pages"}`
        : formatByteSize(entry.byteSize),
    };
  }

  if (entry.kind === "table") {
    const table = await readTablePreview(entry.filePath);
    if (!table) return plainCard(id, entry);
    return {
      ...base,
      kind: "table",
      table,
      subtitle: `${table.totalRows.toLocaleString()} rows · ${table.totalColumns} columns`,
    };
  }

  if (entry.kind === "bundle" || entry.kind === "folder") {
    const extensions = entry.isDirectory
      ? await folderEntryExtensions(entry.filePath)
      : await archiveEntryExtensions(entry.filePath);
    if (!extensions) return plainCard(id, entry);
    const composition = describeComposition(extensions);
    return {
      ...base,
      kind: "bundle",
      composition,
      fileCount: extensions.length,
      subtitle: `${extensions.length} ${extensions.length === 1 ? "file" : "files"}`,
    };
  }

  return plainCard(id, entry);
};

const buildStackCard = async (
  id: string,
  entries: SourceEntry[],
  sourceKind: EvidenceSourceKind,
): Promise<EvidenceCard> => {
  const box = boxFor("stack");
  const chosen = entries.slice(0, STACK_FRAME_CAP);
  const frames = await Promise.all(
    chosen.map(async (entry) => {
      const thumbnail =
        sourceKind === "image"
          ? await rasterizeImageFile(entry.filePath, box.width, box.height)
          : await videoPosterRaster(entry.filePath, box.width, box.height);
      return {
        title: humanTitleFor(entry.filePath, entry.kind),
        sourcePath: entry.filePath,
        ...(thumbnail ? { thumbnail } : {}),
      };
    }),
  );
  return {
    id,
    kind: "stack",
    title: stackTitleFor(
      entries.map((entry) => entry.filePath),
      sourceKind,
    ),
    subtitle: `${entries.length} items · click to flip through`,
    sourcePaths: entries.map((entry) => entry.filePath),
    frames,
    fileCount: entries.length,
  };
};

const buildCard = async (id: string, plan: CardPlan): Promise<EvidenceCard> => {
  if (plan.kind === "single") return await buildSingleCard(id, plan.entry);
  return await buildStackCard(id, plan.entries, plan.sourceKind);
};

const mapWithLimit = async <Input, Output>(
  items: Input[],
  limit: number,
  worker: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  const results = new Array<Output>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as Input, index);
    }
  });
  await Promise.all(runners);
  return results;
};

const fetchDriveBytes = async (url: string, maxBytes: number): Promise<Buffer | null> => {
  const response = await fetchWithInactivity(fetch, url, {}, {
    label: "Drive evidence",
    idleMs: REQUEST_BUDGET_MS.transferIdle,
  });
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.byteLength > maxBytes ? null : bytes;
};

const driveVideoPoster = async (
  file: DriveEvidenceSource,
  box: { width: number; height: number },
): Promise<{ thumbnail: string; durationMs: number | null } | null> => {
  const remote = await remoteVideoPoster(file.url, box.width, box.height);
  if (remote) return remote;
  if (file.sizeBytes > DRIVE_VIDEO_DOWNLOAD_MAX_BYTES) return null;
  const bytes = await fetchDriveBytes(file.url, DRIVE_VIDEO_DOWNLOAD_MAX_BYTES);
  if (!bytes) return null;
  const dir = path.join(os.tmpdir(), `stella-drive-evidence-${randomUUID()}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    const local = path.join(dir, `source${path.extname(file.drivePath).toLowerCase()}`);
    await fs.writeFile(local, bytes);
    const [thumbnail, durationMs] = await Promise.all([
      videoPosterRaster(local, box.width, box.height),
      probeDurationMs(local),
    ]);
    return thumbnail ? { thumbnail, durationMs } : null;
  } finally {
    void fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const buildDriveCard = async (
  id: string,
  file: DriveEvidenceSource,
): Promise<EvidenceCard | null> => {
  const kind = evidenceSourceKind(file.drivePath, false);
  const base = {
    id,
    title: humanTitleFor(file.drivePath, kind),
    sourcePaths: [driveLinkTarget(file.drivePath)],
    byteSize: file.sizeBytes,
  };
  if (kind === "image") {
    if (file.sizeBytes > DRIVE_IMAGE_MAX_BYTES) return null;
    const bytes = await fetchDriveBytes(file.url, DRIVE_IMAGE_MAX_BYTES);
    if (!bytes) return null;
    const image = nativeImage.createFromBuffer(bytes);
    const box = boxFor("image");
    const thumbnail = coverCropToDataUrl(image, box.width, box.height);
    if (!thumbnail) return null;
    const size = image.getSize();
    return {
      ...base,
      kind: "image",
      thumbnail,
      subtitle:
        size.width > 0 && size.height > 0
          ? `${size.width} × ${size.height}`
          : formatByteSize(file.sizeBytes),
    };
  }
  if (kind === "video") {
    const poster = await driveVideoPoster(file, boxFor("video"));
    if (!poster) return null;
    return {
      ...base,
      kind: "video",
      thumbnail: poster.thumbnail,
      ...(poster.durationMs
        ? { durationMs: poster.durationMs, subtitle: formatDuration(poster.durationMs) }
        : {}),
    };
  }
  return null;
};

export type ChatEvidenceService = {
  buildCardSet: (filePaths: string[]) => Promise<EvidenceCardSet>;
  buildDriveCards: (files: DriveEvidenceSource[]) => Promise<EvidenceCard[]>;
};

export const createChatEvidenceService = (options: {
  getStellaDataDir: () => string | null;
  peerDeviceFiles?: PeerDeviceFiles;
  getActiveConversationId?: () => string | null;
}): ChatEvidenceService => {
  const memory = new Map<string, EvidenceCard>();
  const inFlight = new Map<string, Promise<EvidenceCard>>();
  const driveInFlight = new Map<string, Promise<EvidenceCard | null>>();

  const cachePathFor = (cacheKey: string): string | null => {
    const dataDir = options.getStellaDataDir();
    if (!dataDir?.trim()) return null;
    const digest = createHash("sha1").update(cacheKey).digest("hex");
    return path.join(dataDir, CACHE_DIRNAME, `${digest}.json`);
  };

  const readCached = async (cacheKey: string): Promise<EvidenceCard | null> => {
    const cached = memory.get(cacheKey);
    if (cached) return cached;
    const file = cachePathFor(cacheKey);
    if (!file) return null;
    try {
      const raw = await fs.readFile(file, "utf-8");
      const parsed = JSON.parse(raw) as EvidenceCard;
      if (!parsed || typeof parsed.kind !== "string") return null;
      memory.set(cacheKey, parsed);
      return parsed;
    } catch {
      return null;
    }
  };

  const writeCached = async (cacheKey: string, card: EvidenceCard): Promise<void> => {
    memory.set(cacheKey, card);
    const file = cachePathFor(cacheKey);
    if (!file) return;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(card), "utf-8");
    } catch {
      return;
    }
  };

  const peerCard = async (entry: SourceEntry): Promise<EvidenceCard | null> => {
    const peers = options.peerDeviceFiles;
    const holder = entry.holder;
    const dataDir = options.getStellaDataDir();
    if (!peers || !holder || !dataDir?.trim()) return null;
    if (entry.kind !== "image" && entry.kind !== "video") return null;
    if (entry.kind === "image" && entry.byteSize > PEER_IMAGE_MAX_BYTES) return null;
    const cacheKey = `${CACHE_SCHEMA}:peer:${holder.deviceId}:${entry.filePath}:${entry.byteSize}:${holder.modifiedAt}`;
    const cached = await readCached(cacheKey);
    if (cached) return cached;
    const length =
      entry.kind === "image"
        ? entry.byteSize
        : Math.min(entry.byteSize, PEER_VIDEO_HEAD_BYTES);
    const conversationId = options.getActiveConversationId?.() ?? null;
    const parts: Uint8Array[] = [];
    for (const range of deviceFileReadRanges(length)) {
      parts.push(
        (await peers.read(holder.deviceId, entry.filePath, range, conversationId)).bytes,
      );
    }
    const digest = createHash("sha1").update(cacheKey).digest("hex");
    const copyPath = path.join(
      dataDir,
      CACHE_DIRNAME,
      "peer",
      `${digest}${path.extname(entry.filePath).toLowerCase()}`,
    );
    await fs.mkdir(path.dirname(copyPath), { recursive: true });
    await fs.writeFile(copyPath, Buffer.concat(parts));
    try {
      const card = await buildSingleCard(`peer:${digest.slice(0, 32)}`, {
        ...entry,
        filePath: copyPath,
        elsewhere: false,
      });
      if (card.kind === "plain") return null;
      const placed: EvidenceCard = {
        ...card,
        title: humanTitleFor(entry.filePath, entry.kind),
        sourcePaths: [entry.filePath],
        byteSize: entry.byteSize,
      };
      await writeCached(cacheKey, placed);
      return placed;
    } finally {
      await fs.rm(copyPath, { force: true }).catch(() => undefined);
    }
  };

  const cardFor = async (plan: CardPlan): Promise<EvidenceCard> => {
    if (plan.kind === "single" && plan.entry.elsewhere) {
      return (await peerCard(plan.entry).catch(() => null)) ?? elsewhereCard(plan.entry);
    }
    const cacheKey = await planCacheKey(plan);
    const cached = await readCached(cacheKey);
    if (cached) return cached;
    const pending = inFlight.get(cacheKey);
    if (pending) return await pending;
    const work = (async () => {
      try {
        const card = await buildCard(cacheKey.slice(0, 40), plan);
        await writeCached(cacheKey, card);
        return card;
      } finally {
        inFlight.delete(cacheKey);
      }
    })();
    inFlight.set(cacheKey, work);
    return await work;
  };

  return {
    buildCardSet: async (filePaths: string[]): Promise<EvidenceCardSet> => {
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const candidate of filePaths) {
        const resolved = path.resolve(candidate);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        unique.push(resolved);
      }
      const described = await Promise.all(
        unique.map((filePath, index) => describeSource(filePath, index)),
      );
      const holders = await Promise.all(
        described.map(async (entry, index) => {
          const filePath = unique[index] as string;
          if (entry || cloudWorldDrivePath(filePath) !== null || !options.peerDeviceFiles) {
            return null;
          }
          return await options.peerDeviceFiles
            .findHolder(filePath, {
              conversationId: options.getActiveConversationId?.() ?? null,
            })
            .catch(() => null);
        }),
      );
      const entries = described.flatMap((entry, index): SourceEntry[] => {
        if (entry) return [entry];
        const filePath = unique[index] as string;
        if (cloudWorldDrivePath(filePath) !== null) return [];
        const holder = holders[index];
        const isDirectory = holder?.stat.kind === "directory";
        return [
          {
            filePath,
            kind: evidenceSourceKind(filePath, isDirectory),
            byteSize: holder && !isDirectory ? holder.stat.sizeBytes : 0,
            isDirectory,
            order: index,
            elsewhere: true,
            ...(holder
              ? {
                  holder: {
                    deviceId: holder.computer.deviceId,
                    modifiedAt: holder.stat.modifiedAt,
                  },
                }
              : {}),
          },
        ];
      });
      if (entries.length === 0) return { cards: [], overflowCount: 0 };
      const plans = planCards(entries);
      const shown = plans.slice(0, EVIDENCE_CARD_CAP);
      const hidden = plans.slice(EVIDENCE_CARD_CAP);
      const overflowCount = hidden.reduce(
        (total, plan) =>
          total +
          (plan.kind === "single" ? 1 : plan.entries.length),
        0,
      );
      const cards = await mapWithLimit(shown, GENERATION_CONCURRENCY, (plan) =>
        cardFor(plan),
      );
      return { cards, overflowCount };
    },
    buildDriveCards: async (files: DriveEvidenceSource[]): Promise<EvidenceCard[]> => {
      const unique = files.filter(
        (file, index) =>
          driveLinkPath(driveLinkTarget(file.drivePath)) === file.drivePath &&
          files.findIndex((other) => other.drivePath === file.drivePath) === index,
      );
      const cards = await mapWithLimit(
        unique.slice(0, EVIDENCE_CARD_CAP),
        GENERATION_CONCURRENCY,
        async (file): Promise<EvidenceCard | null> => {
          const cacheKey = `${CACHE_SCHEMA}:drive:${file.drivePath}:${file.sizeBytes}`;
          const cached = await readCached(cacheKey);
          if (cached) return cached;
          const pending = driveInFlight.get(cacheKey);
          if (pending) return await pending;
          const id = `drive:${createHash("sha1").update(cacheKey).digest("hex").slice(0, 32)}`;
          const work = buildDriveCard(id, file)
            .catch(() => null)
            .then(async (card) => {
              if (card) await writeCached(cacheKey, card);
              return card;
            })
            .finally(() => driveInFlight.delete(cacheKey));
          driveInFlight.set(cacheKey, work);
          return await work;
        },
      );
      return cards.filter((card): card is EvidenceCard => card !== null);
    },
  };
};
