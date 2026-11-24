import fs from "node:fs/promises";
import path from "node:path";
import { isDocumentFolderAsset } from "@stella/contracts/html-relative-assets";
import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import type { LocalChatEventRecord } from "@stella/node-shared/storage/shared";

export const isPathInside = (candidate: string, base: string): boolean =>
  candidate === base || candidate.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

export const localChatLinkedPaths = (
  events: ReadonlyArray<LocalChatEventRecord>,
): string[] => {
  const paths: string[] = [];
  for (const event of events) {
    const payload = event.payload;
    if (!payload || typeof payload !== "object") continue;
    const text =
      event.type === "assistant_message" && typeof payload.text === "string"
        ? payload.text
        : event.type === "agent-completed" && typeof payload.result === "string"
          ? payload.result
          : "";
    if (text) paths.push(...extractLocalFileLinkPaths(text));
  }
  return paths;
};

export const pathAndAncestors = (requested: string): string[] => {
  const out: string[] = [];
  let current = path.resolve(requested);
  for (;;) {
    out.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return out;
};

const realOrNull = async (target: string): Promise<string | null> =>
  await fs.realpath(target).catch(() => null);

export const linkedPathsGrant = async (
  resolved: string,
  linkedPaths: readonly string[],
): Promise<boolean> => {
  const requestedReal = await realOrNull(resolved);
  if (!requestedReal) return false;
  for (const linked of new Set(linkedPaths.map((entry) => path.resolve(entry)))) {
    const stats = await fs.lstat(linked).catch(() => null);
    if (!stats || stats.isSymbolicLink()) continue;
    const linkedReal = await realOrNull(linked);
    if (!linkedReal) continue;
    if (stats.isFile()) {
      if (requestedReal === linkedReal) return true;
      if (isDocumentFolderAsset(linkedReal, requestedReal)) return true;
      continue;
    }
    if (stats.isDirectory() && isPathInside(requestedReal, linkedReal)) {
      return true;
    }
  }
  return false;
};

