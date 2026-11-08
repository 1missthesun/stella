#!/usr/bin/env node
// Copies the third-party runtimes installs download from GitHub releases (Bun,
// PortableGit, Electron) into Stella's releases bucket, under
// `runtimes/github/<the same path as on github.com>`. Launchers and
// ensure-electron-binary try that mirror first and fall back to GitHub, whose
// release downloads time out or answer 502/504 for minutes at a time.
//
// Run it after changing a pinned Bun/PortableGit URL in launcher/ or the
// Electron version in package.json. Every file is checked against the sha256
// pinned in this repo before upload, and files already mirrored are skipped.
//
//   env -u CLOUDFLARE_API_TOKEN node scripts/mirror-runtimes.mjs [--dry-run]

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BUCKET = "stella-files";
const PUBLIC_BASE = "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev";
const PREFIX = "runtimes/github/";
const root = path.resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const read = (file) => readFileSync(path.join(root, file), "utf8");

/** GitHub URLs pinned in the launchers, each followed by its sha256. */
const launcherAssets = () => {
  const assets = new Map();
  const files = [
    "launcher/linux/stella-launcher.c",
    "launcher/macos/Sources/StellaLauncher/Support.swift",
    "launcher/windows/stella-launcher.cpp",
  ];
  const pattern = /"(https:\/\/github\.com\/[^"]+)"[\s\S]{0,80}?"([0-9a-f]{64})"/g;
  for (const file of files) {
    for (const [, url, sha256] of read(file).matchAll(pattern)) assets.set(url, sha256);
  }
  return assets;
};

const electronAssets = () => {
  const { version } = JSON.parse(read("node_modules/electron/package.json"));
  const checksums = JSON.parse(read("node_modules/electron/checksums.json"));
  const assets = new Map();
  for (const target of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]) {
    const name = `electron-v${version}-${target}.zip`;
    if (!checksums[name]) throw new Error(`checksums.json has no ${name}`);
    assets.set(`https://github.com/electron/electron/releases/download/v${version}/${name}`, checksums[name]);
  }
  return assets;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// npmmirror republishes these exact release files; with the sha256 check it is
// a safe second source for seeding the mirror while GitHub is failing.
const NPMMIRROR_PATHS = [
  ["oven-sh/bun/releases/download/", "bun/"],
  ["electron/electron/releases/download/", "electron/"],
  ["git-for-windows/git/releases/download/", "git-for-windows/"],
];
const seedSources = (url) => {
  const rest = url.slice("https://github.com/".length);
  const sources = [url];
  for (const [github, npmmirror] of NPMMIRROR_PATHS) {
    if (rest.startsWith(github)) {
      sources.push(`https://registry.npmmirror.com/-/binary/${npmmirror}${rest.slice(github.length)}`);
    }
  }
  return sources;
};

const fetchVerified = async (url, sha256) => {
  let lastError;
  const sources = seedSources(url);
  for (let attempt = 1; attempt <= 6; attempt++) {
    const source = sources[(attempt - 1) % sources.length];
    try {
      const response = await fetch(source, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== sha256) throw new Error(`sha256 ${actual}, expected ${sha256}`);
      return bytes;
    } catch (error) {
      lastError = error;
      console.log(`  attempt ${attempt} (${new URL(source).hostname}) failed: ${error.message}`);
      await sleep(Math.min(60_000, 5_000 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`${url}: ${lastError?.message}`);
};

const mirrored = async (key, sha256) => {
  try {
    const response = await fetch(`${PUBLIC_BASE}/${key}`, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    return createHash("sha256").update(bytes).digest("hex") === sha256;
  } catch {
    return false;
  }
};

const assets = new Map([...launcherAssets(), ...electronAssets()]);
const work = mkdtempSync(path.join(tmpdir(), "stella-mirror-"));
let failed = 0;
try {
  for (const [url, sha256] of assets) {
    const key = PREFIX + url.slice("https://github.com/".length);
    if (await mirrored(key, sha256)) {
      console.log(`ok (already mirrored) ${key}`);
      continue;
    }
    if (dryRun) {
      console.log(`would mirror ${url} -> ${key}`);
      continue;
    }
    console.log(`mirroring ${url}`);
    try {
      const bytes = await fetchVerified(url, sha256);
      const file = path.join(work, path.basename(key));
      writeFileSync(file, bytes);
      const put = spawnSync(
        "bunx",
        ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--remote",
          "--content-type", "application/octet-stream", "--cache-control", "public, max-age=31536000, immutable"],
        { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
      );
      rmSync(file, { force: true });
      if (put.status !== 0) throw new Error(`wrangler r2 object put exited ${put.status}`);
      if (!(await mirrored(key, sha256))) throw new Error("the mirrored copy does not match after upload");
      console.log(`ok ${key}`);
    } catch (error) {
      failed++;
      console.error(`FAILED ${url}: ${error.message}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`${assets.size} runtimes, ${failed} failed`);
process.exit(failed ? 1 : 0);
