import { promises as fs } from "node:fs";
import path from "node:path";

import { ensurePrivateDir } from "../shared/private-fs.js";
import { listTrackedBundledSkillIds } from "./skills-sync.js";

export type ResetCustomizationsResult = {
  movedEntries: string[];
  trashDir: string | null;
  failed: { entry: string; message: string } | null;
};

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

const listMarkdownFiles = async (dir: string): Promise<string[]> => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

const listDirectories = async (dir: string): Promise<string[]> => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

export const resetStellaCustomizations = async (
  stellaDataDir: string,
): Promise<ResetCustomizationsResult> => {
  const candidates: string[] = [];

  for (const area of ["agents", "prompts"] as const) {
    for (const name of await listMarkdownFiles(
      path.join(stellaDataDir, area),
    )) {
      candidates.push(path.join(area, name));
    }
  }

  try {
    await fs.access(path.join(stellaDataDir, "PERSONALITY.md"));
    candidates.push("PERSONALITY.md");
  } catch {}

  const skillsRoot = path.join(stellaDataDir, "skills");
  const bundledSkillIds = new Set(await listTrackedBundledSkillIds(skillsRoot));
  for (const id of await listDirectories(skillsRoot)) {
    if (bundledSkillIds.has(id)) {
      candidates.push(path.join("skills", id));
    }
  }

  if (candidates.length === 0) {
    return { movedEntries: [], trashDir: null, failed: null };
  }

  const trashDir = path.join(
    stellaDataDir,
    ".trash",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await ensurePrivateDir(trashDir);
  await fs.writeFile(
    path.join(trashDir, "reset.json"),
    `${JSON.stringify({ from: stellaDataDir, entries: candidates }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const moved: string[] = [];
  for (const relPath of candidates) {
    const target = path.join(trashDir, relPath);
    try {
      await ensurePrivateDir(path.dirname(target));
      await fs.rename(path.join(stellaDataDir, relPath), target);
      moved.push(relPath);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      return {
        movedEntries: moved,
        trashDir,
        failed: {
          entry: relPath,
          message:
            errorCode(error) ??
            (error instanceof Error ? error.message : String(error)),
        },
      };
    }
  }
  return { movedEntries: moved, trashDir, failed: null };
};
