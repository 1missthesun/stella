import type { DisplayTabPayload } from "@stella/contracts/desktop/display-payload";
import type { FileEntry } from "@/features/workspace-display/files-index";
import { cloudDriveEntry } from "@/features/workspace-display/derive-conversation-files";

// packages/mobile's FilesPage model: what a file is called and what type it is, where it came
// from, which Drive folder holds it, and the sections and tile rows the page lays out.

export type SortOrder = "newest" | "oldest" | "name";
export type SourceFilter = "all" | "cloud" | "computer";
export type FileType = "images" | "videos" | "audio" | "documents" | "pages" | "code" | "other";
export type TypeFilter = "all" | FileType;
export type ThumbnailKind = "image" | "video" | "audio" | "html" | "document" | "text" | "none";

export const FILE_TYPES: readonly FileType[] = ["images", "videos", "audio", "documents", "pages", "code", "other"];

const EXTENSION_TYPES: Record<string, FileType> = {};
const types = (type: FileType, list: string) => {
  for (const ext of list.split(" ")) EXTENSION_TYPES[ext] = type;
};
types("images", "png jpg jpeg gif webp heic heif svg bmp tif tiff avif ico");
types("videos", "mp4 mov m4v webm mkv avi");
types("audio", "mp3 wav m4a aac flac ogg opus aiff");
types("documents", "pdf doc docx xls xlsx ppt pptx md markdown txt rtf csv tsv pages key numbers odt ods odp epub");
types("pages", "html htm");
types("code", "js mjs cjs ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh zsh bash json yaml yml toml xml css scss sql lua dart");

const THUMBNAIL_KINDS: Record<string, ThumbnailKind> = {};
const kinds = (kind: ThumbnailKind, list: string) => {
  for (const ext of list.split(" ")) THUMBNAIL_KINDS[ext] = kind;
};
kinds("image", "png jpg jpeg gif webp bmp svg");
kinds("video", "mp4 mov m4v webm");
kinds("audio", "mp3 wav m4a aac flac ogg");
kinds("html", "html htm");
kinds("text", "md markdown txt csv tsv json yaml yml toml xml css scss sql js mjs cjs ts tsx jsx py rb go rs java kt swift c h cc cpp hpp cs php sh zsh bash lua dart log");
kinds("document", "pdf doc docx xls xlsx ppt pptx");

export const fileExtension = (name: string): string => /\.([A-Za-z0-9]{1,8})$/.exec(name.split(/[?#]/)[0] ?? "")?.[1]?.toLowerCase() ?? "";

export type DriveListing = { path: string; name: string; sizeBytes: number; contentType: string; updatedAt: number };

export type FileRow = {
  key: string;
  title: string;
  extension: string;
  type: FileType;
  thumbnail: ThumbnailKind;
  bucket: Exclude<SourceFilter, "all">;
  /** The file's Drive path, when it is in the Drive (thumbnails and folders come from it). */
  drivePath: string | null;
  /** The Drive folder holding it ("" at the top of the Drive), or null outside the Drive. */
  inFolder: string | null;
  createdAt: number;
  payload: DisplayTabPayload;
  /** The desktop Files list's entry it came from, for its "Remove from list". */
  local: FileEntry | null;
};

const payloadType = (payload: DisplayTabPayload): FileType => {
  switch (payload.kind) {
    case "media":
      if (payload.asset.kind === "image") return "images";
      if (payload.asset.kind === "video") return "videos";
      if (payload.asset.kind === "audio") return "audio";
      return "other";
    case "markdown":
    case "office":
    case "pdf":
    case "file-artifact":
      return "documents";
    case "canvas-html":
    case "url":
      return "pages";
    case "source-diff":
      return "code";
    default:
      return "other";
  }
};

const folderOf = (drivePath: string): string => drivePath.slice(0, Math.max(0, drivePath.lastIndexOf("/")));

const row = (key: string, title: string, path: string, drivePath: string | null, createdAt: number, payload: DisplayTabPayload, local: FileEntry | null): FileRow => {
  const extension = fileExtension(path) || fileExtension(title);
  return {
    key,
    title,
    extension,
    type: EXTENSION_TYPES[extension] ?? payloadType(payload),
    thumbnail: drivePath ? (THUMBNAIL_KINDS[extension] ?? "none") : "none",
    bucket: drivePath ? "cloud" : "computer",
    drivePath,
    inFolder: drivePath ? folderOf(drivePath) : null,
    createdAt,
    payload,
    local,
  };
};

/** FilesSection's entries (the conversation's own files, and the Drive's) as the page's rows. */
export function fileRows(local: readonly FileEntry[], drive: readonly DriveListing[]): FileRow[] {
  const inDrive = new Set(drive.map((file) => file.path));
  const rows: FileRow[] = [];
  for (const entry of local) {
    const cloud = entry.payload?.cloudDrivePath;
    if (cloud && inDrive.has(cloud)) continue;
    rows.push(row(`local:${entry.id}`, entry.title, entry.filePath ?? "", cloud ?? null, entry.createdAt, entry.payload, entry));
  }
  for (const file of drive) {
    const entry = cloudDriveEntry({ path: file.path, name: file.name, sizeBytes: file.sizeBytes, contentType: file.contentType }, file.updatedAt);
    const payload = { ...entry.payload, cloudDrivePath: file.path } as DisplayTabPayload;
    rows.push(row(`drive:${file.path}`, file.name, file.path, file.path, file.updatedAt, payload, null));
  }
  return rows;
}

/** A file's name without its extension, as the tiles and rows show it. */
export const shownName = (row: { title: string; extension: string }): string => {
  const suffix = `.${row.extension}`;
  return row.extension && row.title.length > suffix.length && row.title.toLowerCase().endsWith(suffix) ? row.title.slice(0, -suffix.length) : row.title;
};

export type FolderPeek = { key: string; extension: string; kind: ThumbnailKind; drivePath: string; version: number };
export type FolderEntry = { path: string; name: string; count: number; peeks: FolderPeek[] };

const PEEK_ORDER: ThumbnailKind[] = ["image", "video", "text", "html", "document", "audio", "none"];

/** The folders directly inside `parent`, newest first, each with up to three files to fan on its tile. */
export function folderEntries(rows: readonly FileRow[], parent: string): FolderEntry[] {
  const prefix = parent ? `${parent}/` : "";
  const byPath = new Map<string, FileRow[]>();
  for (const row of rows) {
    if (!row.inFolder || !`${row.inFolder}/`.startsWith(prefix)) continue;
    const name = row.inFolder.slice(prefix.length).split("/")[0];
    if (!name) continue;
    const path = `${prefix}${name}`;
    const held = byPath.get(path);
    if (held) held.push(row);
    else byPath.set(path, [row]);
  }
  return [...byPath]
    .map(([path, held]) => ({
      path,
      name: path.slice(prefix.length),
      count: held.length,
      newest: Math.max(...held.map((row) => row.createdAt)),
      peeks: [...held]
        .sort((a, b) => PEEK_ORDER.indexOf(a.thumbnail) - PEEK_ORDER.indexOf(b.thumbnail) || b.createdAt - a.createdAt)
        .slice(0, 3)
        .reverse()
        .map((row) => ({ key: row.key, extension: row.extension, kind: row.thumbnail, drivePath: row.drivePath ?? "", version: row.createdAt })),
    }))
    .sort((a, b) => b.newest - a.newest)
    .map(({ path, name, count, peeks }) => ({ path, name, count, peeks }));
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const DAY_MS = 24 * 60 * 60_000;
const startOfDay = (ms: number) => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** packages/mobile's list-sections `pastSection`: Today, Yesterday, a weekday, Earlier this month, then months. */
export function pastSection(ms: number, now: number, t: Translate): { key: string; label: string } {
  if (ms <= 0) return { key: "other", label: t("mobile.activityHub.files.types.other") };
  const offset = Math.round((startOfDay(ms) - startOfDay(now)) / DAY_MS);
  if (offset >= 0) return { key: "today", label: t("mobile.activityHub.time.today") };
  if (offset === -1) return { key: "yesterday", label: t("mobile.activityHub.time.yesterday") };
  if (offset > -7) return { key: `day:${offset}`, label: new Date(ms).toLocaleDateString(undefined, { weekday: "long" }) };
  const date = new Date(ms);
  const today = new Date(now);
  const sameYear = date.getFullYear() === today.getFullYear();
  if (sameYear && date.getMonth() === today.getMonth()) return { key: "month:current", label: t("mobile.activityHub.time.earlierThisMonth") };
  return { key: `month:${date.getFullYear()}-${date.getMonth()}`, label: date.toLocaleDateString(undefined, { month: "long", ...(sameYear ? {} : { year: "numeric" }) }) };
}

const timeOfDay = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** A file's time under its name: the time today, weekday and time this week, else the date. */
export function fileTime(ms: number, now: number): string {
  if (ms <= 0) return "";
  const date = new Date(ms);
  if (now - ms < 6 * DAY_MS) {
    return date.toDateString() === new Date(now).toDateString() ? timeOfDay(ms) : `${date.toLocaleDateString(undefined, { weekday: "short" })} ${timeOfDay(ms)}`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) });
}

export const TILE_MIN = 150;
export const TILE_MAX_COLUMNS = 5;
export const TILE_GAP = 18;

export const columnsFor = (width: number): number => Math.min(TILE_MAX_COLUMNS, Math.max(2, Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP))));
