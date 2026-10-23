import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

export const dependencyFingerprint = (root: string): string => {
  const hash = createHash("sha256");
  for (const file of ["bun.lock", "package.json", ...workspaceDirs(root).map((dir) => `${dir}/package.json`)]) {
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

export const isLinkedToApp = (draftRoot: string, appRoot: string): boolean => {
  const modules = path.join(draftRoot, "node_modules");
  if (!lstat(modules)?.isSymbolicLink()) return false;
  try {
    return fs.realpathSync(modules) === fs.realpathSync(path.join(appRoot, "node_modules"));
  } catch {
    return false;
  }
};

const copyWorkspaceLinks = (draftRoot: string, appRoot: string) => {
  for (const dir of workspaceDirs(appRoot)) {
    const from = path.join(appRoot, dir, "node_modules");
    const into = path.join(draftRoot, dir, "node_modules");
    if (!lstat(from)?.isDirectory() || !fs.existsSync(path.join(draftRoot, dir))) continue;
    fs.rmSync(into, { recursive: true, force: true });
    const scratch = path.join(from, ".tmp");
    fs.cpSync(from, into, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => source !== scratch && !source.startsWith(`${scratch}${path.sep}`),
    });
  }
};

const link = (draftRoot: string, appRoot: string) => {
  const modules = path.join(draftRoot, "node_modules");
  const stat = lstat(modules);
  if (stat && !stat.isSymbolicLink()) fs.rmSync(modules, { recursive: true, force: true });
  else if (stat) fs.unlinkSync(modules);
  copyWorkspaceLinks(draftRoot, appRoot);
  fs.symlinkSync(path.join(appRoot, "node_modules"), modules, "dir");
};

export const unlinkFromApp = (draftRoot: string, appRoot: string): boolean => {
  if (!isLinkedToApp(draftRoot, appRoot)) return false;
  fs.unlinkSync(path.join(draftRoot, "node_modules"));
  return true;
};

const install = (bun: string, cwd: string, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(bun, ["install", "--frozen-lockfile"], { cwd, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
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
      else reject(new Error(`Installing the draft's dependencies failed; run \`bun install\` in the draft. ${stderr.trim().slice(-400)}`));
    });
  });

export const prepareDraftDependencies = async (options: {
  draftRoot: string;
  appRoot: string;
  bun?: string;
  timeoutMs?: number;
}): Promise<DraftDependencies> => {
  const startedAt = Date.now();
  const { draftRoot, appRoot } = options;
  const done = (mode: DraftDependencies["mode"]): DraftDependencies => ({ mode, ms: Date.now() - startedAt });
  const linkable =
    process.platform !== "win32" &&
    lstat(path.join(appRoot, "node_modules"))?.isDirectory() === true &&
    dependencyFingerprint(draftRoot) === dependencyFingerprint(appRoot);
  const uiModules = path.join(draftRoot, "packages", "desktop-ui", "node_modules");
  if (linkable) {
    if (isLinkedToApp(draftRoot, appRoot)) {
      copyWorkspaceLinks(draftRoot, appRoot);
      return done("ready");
    }
    if (lstat(path.join(draftRoot, "node_modules"))?.isDirectory() && lstat(uiModules)?.isDirectory()) {
      return done("ready");
    }
    try {
      link(draftRoot, appRoot);
      return done("linked");
    } catch {
      unlinkFromApp(draftRoot, appRoot);
    }
  }
  unlinkFromApp(draftRoot, appRoot);
  let missing = false;
  for (const dir of [draftRoot, path.join(draftRoot, "packages", "desktop-ui")]) {
    const modules = path.join(dir, "node_modules");
    const stat = lstat(modules);
    if (stat?.isDirectory()) continue;
    if (stat) fs.rmSync(modules, { force: true });
    missing = true;
  }
  if (!missing) return done("ready");
  await install(options.bun ?? (process.env.STELLA_BUN_PATH?.trim() || "bun"), draftRoot, options.timeoutMs ?? 300_000);
  return done("installed");
};
