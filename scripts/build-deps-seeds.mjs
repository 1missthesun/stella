#!/usr/bin/env bun
// Builds the dependency seeds an installed Stella's first `bun install` starts
// from (packages/desktop/scripts/install-deps.mjs).
//
//   bun scripts/build-deps-seeds.mjs --tree <app-source tree> --out <dir>
//       [--base-url <url>] [--platforms linux-x64,win-x64,...] [--shards 4]
//       [--write-manifest] [--upload]
//
// For each platform it installs the tree's lockfile with `--os/--cpu` and
// `--ignore-scripts` into an empty bun cache, then packs that cache's package
// folders into a few zstd tar shards (fetched in parallel at install). It
// writes <out>/<lock>/<platform>-<n>.tar.zst and <out>/<lock>/deps-seed.json;
// --write-manifest also puts deps-seed.json in the tree, and --upload puts
// the shards and manifest in R2 (bucket stella-files, deps-seed/<lock>/),
// skipping a lock whose manifest is already there.
//
// The seed must be built by the bun version the launcher installs with
// (packages/desktop/launcher.json); install-deps ignores any other.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const BUCKET = "stella-files";
const RELEASES_URL =
  process.env.STELLA_RELEASES_URL ||
  "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev";
export const ALL_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "win-x64",
  "win-arm64",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (message) => console.log(`[deps-seed] ${message}`);

const bunTarget = (key) => {
  const [system, cpu] = key.split("-");
  return {
    os: { darwin: "darwin", linux: "linux", win: "win32" }[system],
    cpu,
  };
};

// The tree minus anything bun install would not read.
const copyManifests = (tree, dest) => {
  const copy = (relative) => {
    const from = path.join(tree, relative);
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(path.join(dest, relative)), { recursive: true });
    fs.cpSync(from, path.join(dest, relative), { recursive: true });
  };
  for (const name of ["package.json", "bun.lock", "bunfig.toml", "patches"])
    copy(name);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(tree, "package.json"), "utf8"),
  );
  for (const pattern of manifest.workspaces ?? []) {
    const dirs = pattern.endsWith("/*")
      ? fs
          .readdirSync(path.join(tree, pattern.slice(0, -2)), {
            withFileTypes: true,
          })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${pattern.slice(0, -2)}/${entry.name}`)
      : [pattern];
    for (const dir of dirs) copy(`${dir}/package.json`);
  }
};

const folderSize = (dir) => {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += folderSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
};

// bun's cache keeps each package version as <name>@<version>@@@1[...] (under
// @scope/ for scoped names); the other entries are links bun recreates.
const cachedPackages = (cacheDir) => {
  const found = [];
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.includes("@@@")) found.push(entry.name);
    else if (entry.name.startsWith("@")) {
      for (const inner of fs.readdirSync(path.join(cacheDir, entry.name), {
        withFileTypes: true,
      })) {
        if (inner.isDirectory() && inner.name.includes("@@@"))
          found.push(`${entry.name}/${inner.name}`);
      }
    }
  }
  return found.map((name) => ({
    name,
    bytes: folderSize(path.join(cacheDir, name)),
  }));
};

const splitShards = (packages, count) => {
  const shards = Array.from({ length: count }, () => ({ names: [], bytes: 0 }));
  for (const pkg of [...packages].sort((a, b) => b.bytes - a.bytes)) {
    const smallest = shards.reduce((best, shard) =>
      shard.bytes < best.bytes ? shard : best,
    );
    smallest.names.push(pkg.name);
    smallest.bytes += pkg.bytes;
  }
  return shards.filter((shard) => shard.names.length > 0);
};

const hasZstd =
  spawnSync("zstd", ["--version"], { stdio: "ignore" }).status === 0;

const packShard = async (cacheDir, names, file, work) => {
  const list = `${file}.list`;
  fs.writeFileSync(list, `${names.join("\n")}\n`);
  const tarArgs = ["-cf", "-", "-C", cacheDir, "-T", list];
  if (process.platform === "darwin") tarArgs.unshift("--no-mac-metadata");
  const env = { ...process.env, COPYFILE_DISABLE: "1" };
  if (hasZstd) {
    const result = spawnSync(
      "bash",
      [
        "-o",
        "pipefail",
        "-c",
        `tar "$@" | zstd -q -f -19 -T0 -o '${file.replace(/'/g, "'\\''")}'`,
        "bash",
        ...tarArgs,
      ],
      {
        env,
        stdio: ["ignore", "inherit", "inherit"],
        cwd: work,
      },
    );
    if (result.status !== 0 || !fs.existsSync(file))
      throw new Error(`packing ${path.basename(file)} failed`);
  } else {
    const tar = spawnSync("tar", tarArgs, { env, maxBuffer: 4 << 30 });
    if (tar.status !== 0)
      throw new Error(`tar for ${path.basename(file)} failed: ${tar.stderr}`);
    fs.writeFileSync(file, await Bun.zstdCompress(tar.stdout, { level: 15 }));
  }
  fs.rmSync(list, { force: true });
  const bytes = fs.readFileSync(file);
  return { sha256: sha256(bytes), bytes: bytes.length };
};

const buildPlatform = async ({ tree, key, outDir, shardCount, work }) => {
  const started = performance.now();
  const project = path.join(work, `project-${key}`);
  const cacheDir = path.join(work, `cache-${key}`);
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
  copyManifests(tree, project);
  const target = bunTarget(key);
  const install = spawnSync(
    process.execPath,
    [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--os",
      target.os,
      "--cpu",
      target.cpu,
    ],
    {
      cwd: project,
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: cacheDir,
        STELLA_SKIP_DESKTOP_POSTINSTALL: "1",
      },
      encoding: "utf8",
    },
  );
  if (install.status !== 0)
    throw new Error(
      `bun install for ${key} failed:\n${install.stderr || install.stdout}`,
    );
  fs.rmSync(project, { recursive: true, force: true });

  const packages = cachedPackages(cacheDir);
  const shards = [];
  const split = splitShards(packages, shardCount);
  const packed = await Promise.all(
    split.map((shard, index) =>
      packShard(
        cacheDir,
        shard.names,
        path.join(outDir, `${key}-${index + 1}.tar.zst`),
        work,
      ),
    ),
  );
  split.forEach((shard, index) => {
    shards.push({
      url: `${key}-${index + 1}.tar.zst`,
      ...packed[index],
      packages: shard.names.length,
    });
  });
  fs.rmSync(cacheDir, { recursive: true, force: true });
  const total = shards.reduce((sum, shard) => sum + shard.bytes, 0);
  log(
    `${key}: ${packages.length} packages, ${shards.length} shards, ${(total / 1e6).toFixed(0)} MB (${((performance.now() - started) / 1000).toFixed(0)}s)`,
  );
  return { shards };
};

const published = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
};

const r2Put = (key, file, contentType, cacheControl) => {
  const put = spawnSync(
    "bunx",
    [
      "wrangler",
      "r2",
      "object",
      "put",
      `${BUCKET}/${key}`,
      "--file",
      file,
      "--remote",
      "--content-type",
      contentType,
      "--cache-control",
      cacheControl,
    ],
    { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
  if (put.status !== 0)
    throw new Error(`wrangler r2 object put ${key} exited ${put.status}`);
};

// Returns the manifest to put in the tree as packages/desktop/deps-seed.json.
export const buildDepsSeeds = async ({
  tree,
  out,
  baseUrl,
  platforms = ALL_PLATFORMS,
  shardCount = 4,
  upload = false,
  writeManifest = false,
}) => {
  const lock = sha256(fs.readFileSync(path.join(tree, "bun.lock")));
  const wantedBun = JSON.parse(
    fs.readFileSync(path.join(tree, "packages/desktop/launcher.json"), "utf8"),
  ).bun?.version;
  if (wantedBun && wantedBun !== Bun.version) {
    throw new Error(
      `the launcher installs with bun ${wantedBun}; build the seed with that bun, not ${Bun.version}`,
    );
  }
  const base = (baseUrl || `${RELEASES_URL}/deps-seed/${lock}`).replace(
    /\/+$/,
    "",
  );

  let manifest = upload ? await published(`${base}/deps-seed.json`) : null;
  if (manifest?.lock === lock && manifest.bun === Bun.version) {
    log(`seed for ${lock.slice(0, 12)} is already published`);
  } else {
    const outDir = path.join(out, lock);
    fs.mkdirSync(outDir, { recursive: true });
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "stella-deps-seed-"));
    try {
      manifest = {
        version: 1,
        lock,
        bun: Bun.version,
        baseUrl: base,
        platforms: {},
      };
      for (const key of platforms) {
        manifest.platforms[key] = await buildPlatform({
          tree,
          key,
          outDir,
          shardCount,
          work,
        });
      }
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
    const manifestFile = path.join(outDir, "deps-seed.json");
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    if (upload) {
      for (const [key, platform] of Object.entries(manifest.platforms)) {
        for (const shard of platform.shards) {
          r2Put(
            `deps-seed/${lock}/${shard.url}`,
            path.join(outDir, shard.url),
            "application/zstd",
            "public, max-age=31536000, immutable",
          );
        }
        log(`uploaded ${key}`);
      }
      // The manifest last: its presence means every shard is there.
      r2Put(
        `deps-seed/${lock}/deps-seed.json`,
        manifestFile,
        "application/json",
        "public, max-age=300",
      );
    }
  }
  if (writeManifest) {
    fs.writeFileSync(
      path.join(tree, "packages/desktop/deps-seed.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  return manifest;
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const tree = option("tree", "");
  if (!tree) {
    console.error(
      "usage: bun scripts/build-deps-seeds.mjs --tree <app-source tree> --out <dir> [--base-url <url>] [--platforms a,b] [--shards n] [--write-manifest] [--upload]",
    );
    process.exit(2);
  }
  await buildDepsSeeds({
    tree: path.resolve(tree),
    out: path.resolve(
      option("out", path.join(os.tmpdir(), "stella-deps-seed")),
    ),
    baseUrl: option("base-url", ""),
    platforms: option("platforms", ALL_PLATFORMS.join(","))
      .split(",")
      .filter(Boolean),
    shardCount: Number(option("shards", "4")),
    upload: args.includes("--upload"),
    writeManifest: args.includes("--write-manifest"),
  });
}
