import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";

// Browser screenshots outlive the code cell that took them: agents read,
// copy and upload the returned path in later tool calls. Kept per agent (or
// conversation) under <stella data>/media/screenshots and swept by age and
// total size, never at cell or runtime end.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const lastSweepAt = new Map<string, number>();

export const browserScreenshotsRoot = (stellaDataDir: string): string =>
  path.join(stellaDataDir, "media", "screenshots");

const scopeSegment = (scope: string | undefined): string => {
  const cleaned = (scope ?? "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "shared";
};

const fileStamp = (date: Date): string =>
  date.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");

const writeFileAtomic = async (target: string, bytes: Buffer) => {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const saveBrowserScreenshot = async (options: {
  stellaDataDir: string;
  scope: string | undefined;
  bytes: Buffer;
  format: "jpeg" | "png";
  explicitPath?: string;
}): Promise<string> => {
  if (options.explicitPath) {
    await writeFileAtomic(options.explicitPath, options.bytes);
    return options.explicitPath;
  }
  const root = browserScreenshotsRoot(options.stellaDataDir);
  const target = path.join(
    root,
    scopeSegment(options.scope),
    `${fileStamp(new Date())}-${randomUUID().slice(0, 8)}.${options.format === "png" ? "png" : "jpg"}`,
  );
  await writeFileAtomic(target, options.bytes);
  scheduleSweep(root);
  return target;
};

const scheduleSweep = (root: string) => {
  const now = Date.now();
  if (now - (lastSweepAt.get(root) ?? 0) < SWEEP_INTERVAL_MS) return;
  lastSweepAt.set(root, now);
  void sweepBrowserScreenshots(root, now).catch(() => undefined);
};

type StoredScreenshot = { filePath: string; mtimeMs: number; size: number };

export const sweepBrowserScreenshots = async (
  root: string,
  now = Date.now(),
): Promise<void> => {
  const scopes = await readdir(root, { withFileTypes: true }).catch(() => []);
  const kept: StoredScreenshot[] = [];
  for (const scope of scopes) {
    if (!scope.isDirectory()) continue;
    const scopeDir = path.join(root, scope.name);
    const entries = await readdir(scopeDir, { withFileTypes: true }).catch(
      () => [],
    );
    let remaining = 0;
    for (const entry of entries) {
      const filePath = path.join(scopeDir, entry.name);
      if (!entry.isFile()) {
        remaining += 1;
        continue;
      }
      const info = await stat(filePath).catch(() => null);
      if (!info) continue;
      if (now - info.mtimeMs > RETENTION_MS) {
        await rm(filePath, { force: true }).catch(() => undefined);
        continue;
      }
      remaining += 1;
      kept.push({ filePath, mtimeMs: info.mtimeMs, size: info.size });
    }
    if (remaining === 0) await rmdir(scopeDir).catch(() => undefined);
  }
  let total = kept.reduce((sum, item) => sum + item.size, 0);
  if (total <= MAX_TOTAL_BYTES) return;
  kept.sort((left, right) => left.mtimeMs - right.mtimeMs);
  for (const item of kept) {
    if (total <= MAX_TOTAL_BYTES) break;
    await rm(item.filePath, { force: true }).catch(() => undefined);
    total -= item.size;
  }
};
