import fs from "node:fs/promises";
import path from "node:path";
import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import type { LocalChatEventRecord } from "@stella/runtime/kernel/storage/shared";

/**
 * Whether a phone or another of the owner's computers may read a path on
 * this computer, given the paths Stella linked or shared.
 *
 * A linked file grants itself. A linked folder grants itself and everything
 * inside it, judged on real paths so a symlink inside the folder cannot
 * reach out of it. A linked path that is itself a symlink grants nothing:
 * a link planted by a prompt-injected agent must not become a way out.
 */

export const isPathInside = (candidate: string, base: string): boolean =>
  candidate === base || candidate.startsWith(base.endsWith(path.sep) ? base : base + path.sep);

/** The paths assistant replies and agent reports in local chat events link. */
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

/** `requested` and every folder above it, nearest first. */
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

/**
 * True when one of `linkedPaths` grants `resolved` (absolute, normalized).
 * Only paths that exist on this computer grant anything.
 */
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
      continue;
    }
    if (stats.isDirectory() && isPathInside(requestedReal, linkedReal)) {
      return true;
    }
  }
  return false;
};

/** True when `resolved`, or a folder above it, appears among `linkedPaths` at all. */
export const isLinkedOrInsideLinked = (
  resolved: string,
  linkedPaths: readonly string[],
): boolean => {
  const linked = new Set(linkedPaths.map((entry) => path.resolve(entry)));
  return pathAndAncestors(resolved).some((candidate) => linked.has(candidate));
};
