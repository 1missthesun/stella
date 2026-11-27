// Prebuilt code the host may run instead of its sources (the UI boot bundle, the host bundle),
// each recorded with the size and mtime of every file it was built from and of the folders
// holding them, since a new file can change what an import resolves to. A build is used only
// while every stamp still matches.
//
// Stamps are keyed relative to the app folder, so a build made elsewhere (the app bundle a first
// install opens from, scripts/build-app-bundle.mjs) holds wherever it is unpacked. Installed
// packages count as the lockfile they were installed from rather than file by file: the app
// bundle carries no node_modules, and its builds stay current once the launcher installs them
// behind it. A folder's stamp is the names in it, not its mtime and size: those differ between
// file systems and change with what is installed or built beside the sources, which is also why
// the names leave out node_modules, .git, .cache and build output folders (out, dist,
// dist-electron: the launcher's install builds some, such as packages/stella-browser/out). For the same reason the app folder itself is not stamped.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");

export type BuildManifest = { key: string; file: string; stamps: Record<string, string> };

const UNSTAMPED_ENTRIES = new Set(["node_modules", ".git", ".cache", "out", "dist", "dist-electron"]);

export const stampOf = async (file: string): Promise<string | null> => {
  try {
    const s = await stat(file);
    if (!s.isDirectory()) return `${s.mtimeMs}:${s.size}`;
    const names = (await readdir(file)).filter((name) => !UNSTAMPED_ENTRIES.has(name)).sort();
    return `d:${createHash("sha256").update(names.join("\0")).digest("hex").slice(0, 32)}`;
  } catch {
    return null;
  }
};

const LOCKFILE = path.join(REPO_ROOT, "bun.lock");
const inPackages = (file: string) => file.split(path.sep).includes("node_modules");
const keyOf = (file: string) => {
  const relative = path.relative(REPO_ROOT, file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative.split(path.sep).join("/");
};
const pathOf = (key: string) => path.resolve(REPO_ROOT, key);

/** Stamps of the files, every folder holding one (below the repo) and `extra`; null when one is missing. */
export async function stampAll(files: string[], extra: string[] = []): Promise<Record<string, string> | null> {
  const paths = new Set<string>();
  for (const file of [...files, ...extra]) paths.add(inPackages(file) ? LOCKFILE : file);
  for (const file of files) {
    if (inPackages(file)) continue;
    for (let dir = path.dirname(file); dir.startsWith(`${REPO_ROOT}${path.sep}`) && !paths.has(dir); dir = path.dirname(dir)) paths.add(dir);
  }
  const list = [...paths];
  const stamps = await Promise.all(list.map(stampOf));
  const out: Record<string, string> = {};
  for (let i = 0; i < list.length; i++) {
    if (stamps[i] === null) return null;
    out[keyOf(list[i]!)] = stamps[i]!;
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
  const keys = Object.keys(manifest.stamps);
  const now = await Promise.all(keys.map((key) => stampOf(pathOf(key))));
  for (let i = 0; i < keys.length; i++) if (now[i] !== manifest.stamps[keys[i]!]) return null;
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
