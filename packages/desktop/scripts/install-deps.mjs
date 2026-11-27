#!/usr/bin/env bun
// Installs an installed Stella's dependencies, for the launcher:
//
//   bun packages/desktop/scripts/install-deps.mjs      (cwd: the app root)
//
// A live `bun install` of a fresh copy fetches ~630 packages one by one from
// the npm registry, then Electron, serially. This does the same work with
// fewer, parallel downloads:
//
//   - deps-seed.json (written at publish, see scripts/build-deps-seeds.mjs)
//     names this lockfile's packages for each platform as a few zstd tar
//     shards of bun's own cache. They are fetched together and unpacked into
//     bun's cache, so the `bun install` after them needs no network.
//   - Electron's zip (Linux, Windows) downloads at the same time, and is
//     unpacked once `bun install` has put node_modules/electron in place.
//     A Mac launcher runs its own signed Stella.app, and the Rune engine
//     (STELLA_LAUNCHER_ENGINE=rune) needs no Electron at all.
//   - prepare-install.mjs (native helpers, stella-browser, office previews)
//     needs nothing from node_modules, so it runs alongside; the launcher's
//     own prepare-install step then finds it already done.
//
// Every shortcut falls back to what `bun install` does on its own. The exit
// code is bun install's.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  adoptUnpackedElectron,
  electronMirrors,
  extractZipNativelyAsync,
  installElectronZip,
  resolveDownloadArch,
} from "./ensure-electron-binary.mjs";
import { usesSignedElectron } from "./tidy-packages.mjs";

const appRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const startedAt = performance.now();
const seconds = (since = startedAt) =>
  ((performance.now() - since) / 1000).toFixed(1);
const log = (message) =>
  console.log(`[install-deps] ${message} (+${seconds()}s)`);
const describe = (error) =>
  error instanceof Error ? error.message : String(error);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileSha256 = async (file) => {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const platformKey = () => {
  const system = { darwin: "darwin", linux: "linux", win32: "win" }[
    process.platform
  ];
  return system && ["x64", "arm64"].includes(process.arch)
    ? `${system}-${process.arch}`
    : null;
};

const lockHash = sha256(fs.readFileSync(path.join(appRoot, "bun.lock")));

const bunCacheDir = () => {
  if (process.env.BUN_INSTALL_CACHE_DIR)
    return path.resolve(process.env.BUN_INSTALL_CACHE_DIR);
  const result = spawnSync(process.execPath, ["pm", "cache"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  const dir =
    result.status === 0 ? result.stdout.trim().split(/\r?\n/).pop() : "";
  return dir && path.isAbsolute(dir) ? dir : null;
};

const fetchBytes = async (url, expectedSha, label) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (expectedSha && actual !== expectedSha.toLowerCase()) {
    throw new Error(`${label}: checksum mismatch (${actual})`);
  }
  return bytes;
};

const moveWithRetry = (from, to) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return true;
    } catch (error) {
      if (
        error?.code === "EEXIST" ||
        error?.code === "ENOTEMPTY" ||
        fs.existsSync(to)
      )
        return false;
      // Windows: a virus scan can hold a just-written file for a moment.
      if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes(error?.code))
        throw error;
      Bun.sleepSync(100 * (attempt + 1));
    }
  }
};

// Moves each package folder the shard unpacked into bun's cache, keeping any
// that bun (or another install) already put there.
const adoptPackages = (staging, cacheDir) => {
  let moved = 0;
  for (const entry of fs.readdirSync(staging, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@") && !entry.name.includes("@@@")) {
      const scope = path.join(cacheDir, entry.name);
      fs.mkdirSync(scope, { recursive: true });
      for (const inner of fs.readdirSync(path.join(staging, entry.name))) {
        if (
          moveWithRetry(
            path.join(staging, entry.name, inner),
            path.join(scope, inner),
          )
        )
          moved += 1;
      }
    } else if (
      moveWithRetry(
        path.join(staging, entry.name),
        path.join(cacheDir, entry.name),
      )
    ) {
      moved += 1;
    }
  }
  return moved;
};

const seedBunCache = async () => {
  const seed = readJson(
    path.join(appRoot, "packages", "desktop", "deps-seed.json"),
  );
  const key = platformKey();
  if (!seed || !key) return;
  if (seed.lock !== lockHash) {
    log(
      `seed is for another lockfile (${String(seed.lock).slice(0, 12)}); skipping it`,
    );
    return;
  }
  if (seed.bun && seed.bun !== Bun.version) {
    log(`seed is for bun ${seed.bun}, not ${Bun.version}; skipping it`);
    return;
  }
  const shards = seed.platforms?.[key]?.shards;
  if (!Array.isArray(shards) || shards.length === 0) return;
  const cacheDir = bunCacheDir();
  if (!cacheDir) {
    log("could not find bun's cache; skipping the seed");
    return;
  }
  const marker = path.join(
    cacheDir,
    ".stella-seeds",
    `${lockHash.slice(0, 16)}-${key}`,
  );
  if (fs.existsSync(marker)) return cacheDir;
  fs.mkdirSync(cacheDir, { recursive: true });

  const base = process.env.STELLA_DEPS_SEED_URL || seed.baseUrl || "";
  const seedStarted = performance.now();
  let bytes = 0;
  let moved = 0;
  const results = await Promise.allSettled(
    shards.map(async (shard, index) => {
      const url = /^https?:\/\//.test(shard.url)
        ? shard.url
        : `${base.replace(/\/+$/, "")}/${shard.url}`;
      const compressed = await fetchBytes(
        url,
        shard.sha256,
        `seed shard ${index + 1}`,
      );
      bytes += compressed.length;
      const tar = await Bun.zstdDecompress(compressed);
      const staging = fs.mkdtempSync(
        path.join(cacheDir, `.stella-seed-${index}-`),
      );
      try {
        await new Bun.Archive(tar).extract(staging);
        moved += adoptPackages(staging, cacheDir);
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    }),
  );
  const failed = results.filter((result) => result.status === "rejected");
  for (const failure of failed) log(`seed: ${describe(failure.reason)}`);
  log(
    `seed ${key}: ${shards.length - failed.length}/${shards.length} shards, ${(bytes / 1e6).toFixed(0)} MB, ${moved} packages added to bun's cache in ${seconds(seedStarted)}s`,
  );
  if (failed.length === 0) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
  }
  return cacheDir;
};

// Electron for Linux and Windows, fetched while the packages install.
const electronPlan = () => {
  if (process.env.STELLA_LAUNCHER_ENGINE === "rune") return null;
  if (
    !["linux", "win32"].includes(process.platform) ||
    usesSignedElectron(appRoot)
  )
    return null;
  const version = readJson(path.join(appRoot, "package.json"))?.dependencies
    ?.electron;
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) return null;
  const file = `electron-v${version}-${process.platform}-${resolveDownloadArch()}.zip`;
  return {
    version,
    file,
    urls: electronMirrors().map((mirror) => `${mirror}v${version}/${file}`),
  };
};

// Electron's checksums.json ships in its npm package: in node_modules once
// bun install is done, and in bun's cache as soon as the seed is in.
const electronChecksum = (plan, cacheDir) => {
  const sources = [
    path.join(appRoot, "node_modules", "electron", "checksums.json"),
  ];
  if (cacheDir)
    sources.push(
      path.join(cacheDir, `electron@${plan.version}@@@1`, "checksums.json"),
    );
  for (const file of sources) {
    const sum = readJson(file)?.[plan.file];
    if (sum) return sum;
  }
  return null;
};

// Downloads into the app's .git folder, which is on the same volume as
// node_modules, so the unpacked copy can be moved into place.
const fetchElectron = async (plan, seeded) => {
  const fetchStarted = performance.now();
  const gitDir = path.join(appRoot, ".git");
  const dir = fs.mkdtempSync(
    path.join(fs.existsSync(gitDir) ? gitDir : os.tmpdir(), "stella-electron-"),
  );
  const zipPath = path.join(dir, plan.file);
  const download = { dir, zipPath, unpacked: null };
  let lastError;
  for (const url of plan.urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await Bun.write(zipPath, response);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      log(`Electron download from ${url} failed: ${describe(error)}`);
    }
  }
  if (lastError) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw lastError;
  }
  log(
    `downloaded ${plan.file} (${(fs.statSync(zipPath).size / 1e6).toFixed(0)} MB) in ${seconds(fetchStarted)}s`,
  );

  // Unpack now if the checksum is already at hand, while bun still installs.
  const expected = electronChecksum(plan, await seeded);
  if (expected) {
    try {
      const actual = await fileSha256(zipPath);
      if (actual !== expected) throw new Error(`checksum mismatch (${actual})`);
      const unpacked = path.join(dir, "dist");
      await extractZipNativelyAsync(zipPath, unpacked);
      Object.assign(download, { unpacked, verified: expected });
      log(`unpacked Electron ${plan.version}`);
    } catch (error) {
      log(`could not unpack ${plan.file} early: ${describe(error)}`);
    }
  }
  return download;
};

const installElectron = async (plan, download) => {
  const expected = electronChecksum(plan, null);
  if (!expected)
    throw new Error(`node_modules/electron/checksums.json has no ${plan.file}`);
  if (download.unpacked && download.verified === expected) {
    await adoptUnpackedElectron(download.unpacked, process.platform);
  } else {
    const actual = await fileSha256(download.zipPath);
    if (actual !== expected)
      throw new Error(`${plan.file} checksum mismatch (${actual})`);
    await installElectronZip(download.zipPath, process.platform, {
      shared: false,
    });
  }
  log(`Electron ${plan.version} is in place`);
};

const runPrepareInstall = () => {
  const script = path.join(
    appRoot,
    "packages",
    "desktop",
    "scripts",
    "prepare-install.mjs",
  );
  if (!fs.existsSync(script)) return Promise.resolve();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: appRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    const done = (status) => {
      process.stdout.write(Buffer.concat(output));
      log(`prepare-install ${status === 0 ? "finished" : `exited ${status}`}`);
      resolve();
    };
    child.once("error", (error) => {
      log(`prepare-install did not start: ${describe(error)}`);
      resolve();
    });
    child.once("close", done);
  });
};

// In a fresh process: this one looked for node_modules before bun made it,
// and bun's resolver remembers that.
const prebuildElectronBundles = () =>
  new Promise((resolve) => {
    const script = path.join(import.meta.dirname, "dev-electron-build.mjs");
    const child = spawn(
      process.execPath,
      [
        "--eval",
        `const { built } = await (await import(${JSON.stringify(pathToFileURL(script).href)})).ensureElectronBundlesFresh(); console.log(built ? "built" : "fresh");`,
      ],
      { cwd: appRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const output = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => output.push(chunk));
    child.once("error", (error) => {
      log(
        `could not bundle Stella's main process (it bundles at launch): ${describe(error)}`,
      );
      resolve();
    });
    child.once("close", (status) => {
      const text = Buffer.concat(output).toString().trim();
      if (status === 0)
        log(
          `Stella's main process ${text.endsWith("fresh") ? "was already bundled" : "is bundled"}`,
        );
      else
        log(
          `could not bundle Stella's main process (it bundles at launch): ${text.split("\n").slice(-3).join(" ")}`,
        );
      resolve();
    });
  });

const bunInstall = (env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["install", "--frozen-lockfile"], {
      cwd: appRoot,
      env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      console.error(
        `[install-deps] bun install did not start: ${describe(error)}`,
      );
      resolve(1);
    });
    child.once("close", (status) => resolve(status ?? 1));
  });

const main = async () => {
  log(
    `lock ${lockHash.slice(0, 12)}, platform ${platformKey() ?? process.platform}, bun ${Bun.version}`,
  );
  const prepared = runPrepareInstall();
  const seeded = seedBunCache().catch((error) => {
    log(`seed failed: ${describe(error)}`);
    return null;
  });
  const plan = electronPlan();
  const electron = plan
    ? fetchElectron(plan, seeded).catch((error) => ({ error }))
    : null;

  await seeded;
  const env = { ...process.env };
  if (plan) {
    env.STELLA_SKIP_ELECTRON_BINARY = "1";
    env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  }
  const installStarted = performance.now();
  const status = await bunInstall(env);
  log(
    `bun install ${status === 0 ? "finished" : `exited ${status}`} in ${seconds(installStarted)}s`,
  );

  // Stella's first launch bundles its Electron main process; do it now,
  // while Electron unpacks.
  const bundled =
    status === 0 && process.env.STELLA_LAUNCHER_ENGINE !== "rune"
      ? prebuildElectronBundles()
      : null;

  if (electron) {
    const download = await electron;
    try {
      if (status === 0) {
        if (download.error) throw download.error;
        await installElectron(plan, download);
      }
    } catch (error) {
      log(`${describe(error)}; fetching Electron the usual way`);
      const { ensureElectronBinary } = await import(
        "./ensure-electron-binary.mjs"
      );
      await ensureElectronBinary().catch((repairError) =>
        console.error(
          `[install-deps] Electron is not installed: ${describe(repairError)}`,
        ),
      );
    } finally {
      if (download.dir)
        fs.rmSync(download.dir, { recursive: true, force: true });
    }
  }

  await bundled;
  await prepared;
  log(`done in ${seconds()}s`);
  return status;
};

process.exit(await main());
