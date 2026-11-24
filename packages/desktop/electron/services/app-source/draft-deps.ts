import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDirectoryLink, linkDirectorySync, removeDirectoryLinkSync, removeTree } from "./dir-links.js";
import { git } from "./git.js";

export type DraftDependencies = { mode: "ready" | "linked" | "installed"; ms: number };

const lstat = (file: string) => fs.lstatSync(file, { throwIfNoEntry: false });

const workspaceDirs = (root: string): string[] => {
  let patterns: string[] = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      workspaces?: string[] | { packages?: string[] };
    };
    patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : (manifest.workspaces?.packages ?? []);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      dirs.push(pattern);
      continue;
    }
    const parent = pattern.slice(0, -2);
    if (!fs.existsSync(path.join(root, parent))) continue;
    for (const entry of fs.readdirSync(path.join(root, parent), { withFileTypes: true, encoding: "utf8" })) {
      if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
    }
  }
  return dirs.filter((dir) => fs.existsSync(path.join(root, dir, "package.json"))).sort();
};

const patchFiles = (root: string): string[] => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      patchedDependencies?: Record<string, string>;
    };
    return Object.values(manifest.patchedDependencies ?? {}).sort();
  } catch {
    return [];
  }
};

const manifestFiles = (root: string) => [
  "bun.lock",
  "package.json",
  ...workspaceDirs(root).map((dir) => `${dir}/package.json`),
  ...patchFiles(root),
];

export const dependencyFingerprint = (root: string): string => {
  const hash = createHash("sha256");
  for (const file of manifestFiles(root)) {
    hash.update(`${file}\0`);
    try {
      hash.update(fs.readFileSync(path.join(root, file)));
    } catch {
      hash.update("missing");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
};

/**
 * Package sets live beside the install they serve, never inside a worktree,
 * so removing a draft can't reach them. On Windows they sit right next to
 * the app with short names: bun's store paths are already long, and a set
 * inside the app's git folder pushed some past 260 characters. Elsewhere,
 * and for a developer checkout, in the app's git folder.
 */
export const packageSetsDir = (appRoot: string) => {
  const parent = path.dirname(path.resolve(appRoot));
  const launcherInstall = ["launcher-state.json", "launcher.lock"].some((name) => fs.existsSync(path.join(parent, name)));
  if (process.platform === "win32" && launcherInstall) return path.join(parent, "pkgs");
  const gitDir = path.join(appRoot, ".git");
  return lstat(gitDir)?.isDirectory()
    ? path.join(gitDir, "stella-packages")
    : path.join(os.homedir(), ".stella", "cache", "stella-packages");
};

const setName = (fingerprint: string) => fingerprint.slice(0, process.platform === "win32" ? 8 : 12);

const READY = ".stella-ready";

const intact = (store: string): boolean => {
  const bunStore = path.join(store, "node_modules", ".bun");
  let entries: string[];
  try {
    entries = fs.readdirSync(bunStore).filter((name) => name !== "node_modules" && !name.startsWith("."));
  } catch {
    return false;
  }
  if (entries.length === 0) return false;
  for (const entry of entries) {
    const at = entry.indexOf("@", entry.startsWith("@") ? 1 : 0);
    if (at <= 0) continue;
    const name = entry.slice(0, at).replace("+", "/");
    if (!fs.existsSync(path.join(bunStore, entry, "node_modules", name, "package.json"))) return false;
  }
  return true;
};

const install = (bun: string, cwd: string, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(bun, ["install", "--frozen-lockfile", "--ignore-scripts", "--no-summary"], {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Installing the draft's packages failed. ${stderr.trim().slice(-400)}`));
    });
  });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withLock = async <T>(lock: string, timeoutMs: number, work: () => Promise<T>): Promise<T> => {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder = 0;
      try {
        holder = Number(fs.readFileSync(path.join(lock, "pid"), "utf8"));
      } catch {}
      const alive = (() => {
        if (!holder) return true;
        try {
          process.kill(holder, 0);
          return true;
        } catch (probe) {
          return (probe as NodeJS.ErrnoException).code === "EPERM";
        }
      })();
      const age = Date.now() - (lstat(lock)?.mtimeMs ?? Date.now());
      if (!alive || age > timeoutMs) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > until) throw new Error("Timed out waiting for another install of the draft's packages.");
      await delay(500);
    }
  }
  try {
    return await work();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
};

/**
 * The package set for `source`'s dependencies, built when missing or
 * damaged. Built where it stays: Windows junctions hold absolute paths, so a
 * set can't be built elsewhere and moved.
 */
export const ensurePackageSet = async (options: {
  source: string;
  appRoot: string;
  bun?: string;
  timeoutMs?: number;
}): Promise<{ store: string; built: boolean }> => {
  const fingerprint = dependencyFingerprint(options.source);
  const sets = packageSetsDir(options.appRoot);
  const store = path.join(sets, setName(fingerprint));
  const ready = () => {
    try {
      return fs.readFileSync(path.join(store, READY), "utf8").trim() === fingerprint && intact(store);
    } catch {
      return false;
    }
  };
  if (ready()) return { store, built: false };
  fs.mkdirSync(sets, { recursive: true });
  const timeoutMs = options.timeoutMs ?? 300_000;
  return withLock(`${store}.lock`, timeoutMs + 60_000, async () => {
    if (ready()) return { store, built: false };
    await removeTree(store);
    for (const file of manifestFiles(options.source)) {
      const from = path.join(options.source, file);
      if (!fs.existsSync(from)) continue;
      fs.mkdirSync(path.dirname(path.join(store, file)), { recursive: true });
      fs.copyFileSync(from, path.join(store, file));
    }
    await install(options.bun ?? (process.env.STELLA_BUN_PATH?.trim() || "bun"), store, timeoutMs);
    if (!intact(store)) throw new Error("The draft's packages are incomplete after installing them.");
    fs.writeFileSync(path.join(store, READY), fingerprint);
    return { store, built: true };
  });
};

const linkTarget = (link: string) => {
  const raw = fs.readlinkSync(link).replace(/^\\\\\?\\/, "");
  return path.resolve(path.dirname(link), raw);
};

const isInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const mirrorWorkspaceModules = (store: string, root: string, from: string, into: string) => {
  fs.mkdirSync(into, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true, encoding: "utf8" })) {
    const source = path.join(from, entry.name);
    const target = path.join(into, entry.name);
    if (entry.isSymbolicLink()) {
      let pointsAt = linkTarget(source);
      if (isInside(store, pointsAt) && !isInside(path.join(store, "node_modules"), pointsAt)) {
        pointsAt = path.join(root, path.relative(store, pointsAt));
      }
      if (fs.statSync(pointsAt, { throwIfNoEntry: false })?.isDirectory()) linkDirectorySync(pointsAt, target);
      else if (process.platform === "win32") fs.copyFileSync(pointsAt, target);
      else fs.symlinkSync(pointsAt, target);
    } else if (entry.isDirectory()) {
      mirrorWorkspaceModules(store, root, source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
};

const clearModules = async (modules: string) => {
  const stat = lstat(modules);
  if (!stat) return;
  if (stat.isSymbolicLink()) removeDirectoryLinkSync(modules);
  else await removeTree(modules);
};

const linkedTo = (root: string, store: string) => {
  const modules = path.join(root, "node_modules");
  if (!isDirectoryLink(modules)) return false;
  try {
    return fs.realpathSync(modules) === fs.realpathSync(path.join(store, "node_modules"));
  } catch {
    return false;
  }
};

export const linkPackageSet = async (root: string, store: string) => {
  const modules = path.join(root, "node_modules");
  if (!linkedTo(root, store)) {
    await clearModules(modules);
    linkDirectorySync(path.join(store, "node_modules"), modules);
  }
  for (const dir of workspaceDirs(root)) {
    const into = path.join(root, dir, "node_modules");
    await clearModules(into);
    const from = path.join(store, dir, "node_modules");
    if (lstat(from)?.isDirectory()) mirrorWorkspaceModules(store, root, from, into);
  }
};

export const removeUnusedPackageSets = async (appRoot: string, keep: string[]) => {
  const sets = packageSetsDir(appRoot);
  let names: string[];
  try {
    names = fs.readdirSync(sets);
  } catch {
    return;
  }
  const kept = new Set([dependencyFingerprint(appRoot), ...keep].map(setName));
  for (const name of names) {
    if (name.endsWith(".lock") || kept.has(name)) continue;
    if (fs.existsSync(path.join(sets, `${name}.lock`))) continue;
    await removeTree(path.join(sets, name)).catch(() => undefined);
  }
};

const worktreeRoots = async (appRoot: string): Promise<string[]> => {
  const listing = await git(appRoot, ["worktree", "list", "--porcelain"]).catch(() => "");
  return listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((dir) => path.resolve(dir) !== path.resolve(appRoot) && fs.existsSync(dir));
};

/**
 * The repo ignores `/node_modules/`, a folder; a draft's is a link, which git
 * sees as a file and would offer to commit. The app's exclude file covers
 * every worktree of it.
 */
export const ignoreLinkedModules = (appRoot: string) => {
  const exclude = path.join(appRoot, ".git", "info", "exclude");
  try {
    if (!fs.statSync(path.join(appRoot, ".git")).isDirectory()) return;
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
    if (text.split(/\r?\n/).includes("/node_modules")) return;
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    fs.appendFileSync(exclude, `${text && !text.endsWith("\n") ? "\n" : ""}/node_modules\n`);
  } catch {}
};

export const prepareDraftDependencies = async (options: {
  draftRoot: string;
  appRoot: string;
  bun?: string;
  timeoutMs?: number;
}): Promise<DraftDependencies> => {
  const startedAt = Date.now();
  const { draftRoot, appRoot } = options;
  const { store, built } = await ensurePackageSet({
    source: draftRoot,
    appRoot,
    ...(options.bun ? { bun: options.bun } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const already = linkedTo(draftRoot, store);
  await linkPackageSet(draftRoot, store);
  ignoreLinkedModules(appRoot);
  if (built) {
    const others = await worktreeRoots(appRoot);
    await removeUnusedPackageSets(appRoot, [draftRoot, ...others].map(dependencyFingerprint)).catch(() => undefined);
  }
  return { mode: built ? "installed" : already ? "ready" : "linked", ms: Date.now() - startedAt };
};
