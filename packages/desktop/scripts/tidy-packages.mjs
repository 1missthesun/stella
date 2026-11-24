#!/usr/bin/env node
// Keeps an installed Stella's node_modules to what its manifests ask for.
//
// bun never removes what an earlier install left: packages a newer lockfile
// dropped stay in node_modules/.bun, and their top-level links stay too. This
// removes links no manifest asks for and every package nothing reaches. On a
// Mac run by the launcher it also removes Electron's own binary: Stella runs
// from the launcher's signed Stella.app, never from node_modules.
//
//   node tidy-packages.mjs [<app root>] [--dry-run]
//
// Only for an installed copy (the launcher's): a developer checkout keeps
// whatever its installs put there.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";

const lstat = (file) => fs.lstatSync(file, { throwIfNoEntry: false });

export const isLauncherInstall = (appRoot) => {
  let dir = path.resolve(appRoot);
  for (let up = 0; up < 3; up += 1) {
    dir = path.dirname(dir);
    if (fs.existsSync(path.join(dir, "launcher.lock")) && lstat(path.join(dir, "runtimes"))?.isDirectory()) return true;
  }
  return false;
};

export const usesSignedElectron = (appRoot) =>
  process.platform === "darwin" &&
  process.env.STELLA_LAUNCHER_UNSIGNED_ELECTRON?.trim() !== "1" &&
  isLauncherInstall(appRoot);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const workspaceDirs = (root, manifest) => {
  const patterns = Array.isArray(manifest.workspaces) ? manifest.workspaces : (manifest.workspaces?.packages ?? []);
  const dirs = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith("/*")) {
      dirs.push(pattern);
      continue;
    }
    const parent = path.join(root, pattern.slice(0, -2));
    if (!lstat(parent)?.isDirectory()) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(pattern.slice(0, -2), entry.name));
    }
  }
  return dirs.filter((dir) => fs.existsSync(path.join(root, dir, "package.json")));
};

const installsDev = (root) => {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, "bunfig.toml"), "utf8");
  } catch {
    return true;
  }
  const install = /^\s*\[install\]\s*$([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m.exec(text)?.[1] ?? "";
  if (/^\s*dev\s*=\s*false\b/m.test(install)) return false;
  if (/^\s*production\s*=\s*true\b/m.test(install)) return false;
  return true;
};

const wantedNames = (manifest, withDev) =>
  new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...(withDev ? Object.keys(manifest.devDependencies ?? {}) : []),
  ]);

const entriesOf = (modules) => {
  const out = [];
  let names;
  try {
    names = fs.readdirSync(modules, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of names) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(modules, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scoped of fs.readdirSync(full, { withFileTypes: true })) {
        out.push({ name: `${entry.name}/${scoped.name}`, file: path.join(full, scoped.name), link: scoped.isSymbolicLink() });
      }
    } else {
      out.push({ name: entry.name, file: full, link: entry.isSymbolicLink() });
    }
  }
  return out;
};

const unlinkLink = (file) => {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    fs.rmdirSync(file);
  }
};

const removeWalk = (entry) => {
  const stat = lstat(entry);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    unlinkLink(entry);
    return;
  }
  if (!stat.isDirectory()) {
    try {
      fs.unlinkSync(entry);
    } catch (error) {
      if (error.code !== "EPERM") throw error;
      fs.chmodSync(entry, 0o666);
      fs.unlinkSync(entry);
    }
    return;
  }
  for (const name of fs.readdirSync(entry)) removeWalk(path.join(entry, name));
  fs.rmdirSync(entry);
};

const removeEmptyScopes = (modules) => {
  let names = [];
  try {
    names = fs.readdirSync(modules, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of names) {
    if (!entry.name.startsWith("@") || !entry.isDirectory()) continue;
    const dir = path.join(modules, entry.name);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
};

const sizeOf = (entry) => {
  const stat = lstat(entry);
  if (!stat || stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const name of fs.readdirSync(entry)) total += sizeOf(path.join(entry, name));
  return total;
};

const fingerprint = (root, dirs) => {
  const hash = createHash("sha256");
  for (const file of ["bun.lock", "bunfig.toml", "package.json", ...dirs.map((dir) => path.join(dir, "package.json"))]) {
    hash.update(`${file}\0`);
    try {
      hash.update(fs.readFileSync(path.join(root, file)));
    } catch {
      hash.update("missing");
    }
  }
  hash.update(`signed-electron:${usesSignedElectron(root)}`);
  return hash.digest("hex");
};

export const tidyPackages = (appRoot, { dryRun = false, force = false } = {}) => {
  // Run by Stella under Electron, whose fs treats an `.asar` file (Electron's
  // default_app.asar) as a folder and can't delete it.
  process.noAsar = true;
  const root = path.resolve(appRoot);
  const result = { links: 0, packages: 0, bytes: 0, electron: 0, skipped: "" };
  const manifest = readJson(path.join(root, "package.json"));
  const store = path.join(root, "node_modules", ".bun");
  if (!manifest || !lstat(store)?.isDirectory()) return { ...result, skipped: "not an isolated bun install" };
  const dirs = workspaceDirs(root, manifest);
  const stamp = path.join(root, ".git", "stella-tidied-packages");
  const print = fingerprint(root, dirs);
  if (!force && !dryRun) {
    try {
      if (fs.readFileSync(stamp, "utf8").trim() === print) return { ...result, skipped: "already tidy" };
    } catch {}
  }
  const withDev = installsDev(root);

  const roots = [];
  for (const dir of ["", ...dirs]) {
    const own = dir ? readJson(path.join(root, dir, "package.json")) : manifest;
    if (!own) continue;
    const wanted = wantedNames(own, withDev);
    for (const entry of entriesOf(path.join(root, dir, "node_modules"))) {
      if (!entry.link) continue;
      if (wanted.has(entry.name)) roots.push(entry.file);
      else {
        result.links += 1;
        if (!dryRun) unlinkLink(entry.file);
      }
    }
  }

  const storeReal = fs.realpathSync(store);
  const all = fs.readdirSync(store).filter((name) => name !== "node_modules" && !name.startsWith("."));
  const known = new Set(all);
  const reached = new Set();
  const queue = [];
  const visit = (link) => {
    let real;
    try {
      real = fs.realpathSync(link);
    } catch {
      return;
    }
    const relative = path.relative(storeReal, real);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return;
    const entry = relative.split(path.sep)[0];
    if (!known.has(entry) || reached.has(entry)) return;
    reached.add(entry);
    queue.push(entry);
  };
  for (const link of roots) visit(link);
  while (queue.length > 0) {
    const entry = queue.pop();
    for (const dep of entriesOf(path.join(store, entry, "node_modules"))) if (dep.link) visit(dep.file);
  }
  const orphans = all.filter((name) => !reached.has(name));
  if (reached.size === 0 || orphans.length > all.length * 0.8) {
    return { ...result, skipped: `unexpected layout (${reached.size} of ${all.length} reached)` };
  }

  for (const name of orphans) {
    const dir = path.join(store, name);
    result.packages += 1;
    result.bytes += sizeOf(dir);
    if (!dryRun) {
      try {
        removeWalk(dir);
      } catch {}
    }
  }
  if (!dryRun) {
    for (const entry of entriesOf(path.join(store, "node_modules"))) {
      if (entry.link && !fs.existsSync(entry.file)) unlinkLink(entry.file);
    }
    for (const dir of ["", ...dirs]) removeEmptyScopes(path.join(root, dir, "node_modules"));
    removeEmptyScopes(path.join(store, "node_modules"));
  }

  if (usesSignedElectron(root)) {
    try {
      const electron = fs.realpathSync(path.join(root, "node_modules", "electron"));
      const dist = path.join(electron, "dist");
      if (lstat(dist)) {
        result.electron = sizeOf(dist);
        if (!dryRun) {
          removeWalk(dist);
          fs.rmSync(path.join(electron, "path.txt"), { force: true });
        }
      }
    } catch {}
  }

  if (!dryRun) {
    try {
      fs.writeFileSync(stamp, print);
    } catch {}
  }
  return result;
};

if (isEntryPoint(import.meta.url)) {
  const args = process.argv.slice(2);
  const appRoot = args.find((arg) => !arg.startsWith("--")) ?? path.resolve(import.meta.dirname, "..", "..", "..");
  const result = tidyPackages(appRoot, { dryRun: args.includes("--dry-run"), force: args.includes("--force") });
  console.log(JSON.stringify(result));
}
