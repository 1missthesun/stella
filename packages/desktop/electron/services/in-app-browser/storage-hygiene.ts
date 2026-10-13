import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "electron";

const PROFILE_IMPORT_MARKER = ".stella-browser-profile-import-v1.json";

const isLoopbackHost = (host: string) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(host);

const indexedDbFolderOrigin = (name: string): string | null => {
  const match = /^(https?)_(.+)_(\d+)\.indexeddb\.(?:leveldb|blob)$/.exec(name);
  if (!match) return null;
  const [, scheme, host, port] = match;
  const defaultPort = scheme === "https" ? "443" : "80";
  return `${scheme}://${host}${port === "0" || port === defaultPort ? "" : `:${port}`}`;
};

const isLoopbackOrigin = (origin: string) => {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
};

const LOOPBACK_ORIGIN_LIMIT_BYTES = 256 * 1024 * 1024;

const LEGACY_IMPORT_CLEANUP_MARKER = ".stella-browser-import-cleanup-v1";
const LEGACY_CACHE_ENTRIES = new Set(["Service Worker"]);
const LEGACY_DEAD_FILES = [
  "History",
  "History-journal",
  "Favicons",
  "Favicons-journal",
];

const SITE_STORAGES: NonNullable<
  Parameters<Session["clearStorageData"]>[0]
>["storages"] = [
  "indexdb",
  "localstorage",
  "cachestorage",
  "serviceworkers",
  "filesystem",
];

const pathSize = async (target: string): Promise<number> => {
  let info;
  try {
    info = await lstat(target);
  } catch {
    return 0;
  }
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let names: string[];
  try {
    names = await readdir(target);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) total += await pathSize(path.join(target, name));
  return total;
};

const readCopiedEntries = async (profilePath: string): Promise<string[]> => {
  try {
    const marker = JSON.parse(
      await readFile(path.join(profilePath, PROFILE_IMPORT_MARKER), "utf8"),
    ) as { copiedEntries?: unknown };
    return Array.isArray(marker.copiedEntries)
      ? marker.copiedEntries.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
  } catch {
    return [];
  }
};

const removeLegacyImportedData = async (
  profilePath: string,
  browserSession: Session,
) => {
  const markerPath = path.join(profilePath, LEGACY_IMPORT_CLEANUP_MARKER);
  const alreadyCleaned = await lstat(markerPath).then(
    () => true,
    () => false,
  );
  if (alreadyCleaned) return;
  const copied = await readCopiedEntries(profilePath);
  if (copied.some((entry) => LEGACY_CACHE_ENTRIES.has(entry))) {
    await browserSession.clearStorageData({
      storages: ["cachestorage", "serviceworkers"],
    });
  }
  for (const name of LEGACY_DEAD_FILES) {
    if (!copied.includes(name)) continue;
    await rm(path.join(profilePath, name), { force: true, recursive: true });
  }
  await writeFile(markerPath, `${new Date().toISOString()}\n`, "utf8");
};

const clearOversizedLoopbackOrigins = async (
  profilePath: string,
  browserSession: Session,
) => {
  const indexedDbRoot = path.join(profilePath, "IndexedDB");
  let names: string[];
  try {
    names = await readdir(indexedDbRoot);
  } catch {
    return;
  }
  const sizes = new Map<string, number>();
  for (const name of names) {
    const origin = indexedDbFolderOrigin(name);
    if (!origin || !isLoopbackOrigin(origin)) continue;
    const size = await pathSize(path.join(indexedDbRoot, name));
    sizes.set(origin, (sizes.get(origin) ?? 0) + size);
  }
  for (const [origin, size] of sizes) {
    if (size <= LOOPBACK_ORIGIN_LIMIT_BYTES) continue;
    await browserSession.clearStorageData({ origin, storages: SITE_STORAGES });
    console.warn(
      `[in-app-browser] Cleared ${Math.round(size / 1024 / 1024)} MB of storage for ${origin}.`,
    );
  }
};

export const trimInAppBrowserStorage = async (
  profilePath: string,
  browserSession: Session,
) => {
  await removeLegacyImportedData(profilePath, browserSession).catch(
    (error: unknown) => {
      console.warn(
        `[in-app-browser] Legacy import cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );
  await clearOversizedLoopbackOrigins(profilePath, browserSession).catch(
    (error: unknown) => {
      console.warn(
        `[in-app-browser] Loopback storage trim failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  );
};
