// Prebuilt code the host may run instead of its sources (the UI boot bundle, the host bundle),
// each recorded with the size and mtime of every file it was built from and of the folders
// holding them, since a new file can change what an import resolves to. A build is used only
// while every stamp still matches.

import { writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");

export type BuildManifest = { key: string; file: string; stamps: Record<string, string> };

export const stampOf = async (file: string): Promise<string | null> => {
  try {
    const s = await stat(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
};

/** Stamps of the files, every folder holding one (up to the repo) and `extra`; null when one is missing. */
export async function stampAll(files: string[], extra: string[] = []): Promise<Record<string, string> | null> {
  const paths = new Set<string>([...files, ...extra]);
  for (const file of files) {
    for (let dir = path.dirname(file); dir.startsWith(REPO_ROOT) && !paths.has(dir); dir = path.dirname(dir)) paths.add(dir);
  }
  const list = [...paths];
  const stamps = await Promise.all(list.map(stampOf));
  const out: Record<string, string> = {};
  for (let i = 0; i < list.length; i++) {
    if (stamps[i] === null) return null;
    out[list[i]!] = stamps[i]!;
  }
  return out;
}

/** The recorded build in `dir` when every stamp matches, else null. */
export async function currentBuild(dir: string): Promise<BuildManifest | null> {
  let manifest: BuildManifest;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, "current.json"), "utf8")) as BuildManifest;
  } catch {
    return null;
  }
  const paths = Object.keys(manifest.stamps);
  const now = await Promise.all(paths.map(stampOf));
  for (let i = 0; i < paths.length; i++) if (now[i] !== manifest.stamps[paths[i]!]) return null;
  return { ...manifest, file: path.join(dir, manifest.file) };
}

/** A fresh folder under `dir` for one build's output. */
export async function buildFolder(dir: string): Promise<{ name: string; path: string }> {
  const name = `b${Date.now().toString(36)}${process.pid.toString(36)}`;
  const out = path.join(dir, name);
  await mkdir(out, { recursive: true });
  return { name, path: out };
}

const HELD = ".held-";

/** Keeps the build folder holding `file` while this process lives: it reads more of it later (lazy UI files). */
export function holdBuild(file: string) {
  try { writeFileSync(path.join(path.dirname(file), `${HELD}${process.pid}`), ""); } catch {}
}

const heldByLiveProcess = async (folder: string) => {
  for (const entry of await readdir(folder).catch(() => [] as string[])) {
    if (!entry.startsWith(HELD)) continue;
    try {
      process.kill(Number(entry.slice(HELD.length)), 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    }
  }
  return false;
};

/** Records `folder`'s `file` as the current build and removes older ones (an open one stays until it can go; a held one until its process ends). */
export async function recordBuild(dir: string, folder: string, file: string, key: string, stamps: Record<string, string>) {
  const current = path.join(dir, "current.json");
  const temp = `${current}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ key, file: `${folder}/${file}`, stamps } satisfies BuildManifest));
  await rename(temp, current);
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (entry === folder || entry === "current.json" || entry.endsWith(".tmp")) continue;
    if (await heldByLiveProcess(path.join(dir, entry))) continue;
    await rm(path.join(dir, entry), { recursive: true, force: true }).catch(() => {});
  }
}

export const discardFolder = (folder: string) => rm(folder, { recursive: true, force: true }).catch(() => {});
