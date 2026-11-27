#!/usr/bin/env node
// Pins a published stella-engine build in packages/desktop/launcher.json, which is what makes
// launchers start this source on Rune. Publish the build first (workflow "Publish Rune Engine"
// with publish on), then:
//   node scripts/pin-rune-engine.mjs [--version <v>] [--base <url>] [--manifest <file>] [--no-verify]
// --version defaults to the git tree of packages/desktop-rune/engine at HEAD (the version CI
// publishes). Every asset is downloaded and checked against the manifest's sha256 unless
// --no-verify. --manifest pins a local manifest (for a self-test against a local server).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PLATFORMS = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "win-x64", "win-arm64"];
const root = path.resolve(import.meta.dirname, "..");
const launcherJson = path.join(root, "packages/desktop/launcher.json");

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const base = (option("--base") ?? `${process.env.STELLA_RELEASES_URL || "https://pub-a319aaada8144dc9be5a83625033769c.r2.dev"}/runtimes/stella-engine`).replace(/\/+$/, "");
const version =
  option("--version") ??
  execFileSync("git", ["rev-parse", "HEAD:packages/desktop-rune/engine"], { cwd: root, encoding: "utf8" }).trim().slice(0, 12);
const verify = !args.includes("--no-verify");

const fail = (message) => {
  console.error(`pin-rune-engine: ${message}`);
  process.exit(1);
};

const fetchOk = async (url) => {
  const response = await fetch(url);
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);
  return response;
};

const manifestFile = option("--manifest");
const manifestUrl = `${base}/${version}/manifest.json`;
const manifest = manifestFile
  ? JSON.parse(readFileSync(manifestFile, "utf8"))
  : await (await fetchOk(manifestUrl)).json();

if (typeof manifest.version !== "string" || !manifest.assets) fail("the manifest has no version or assets");
if (!manifestFile && manifest.version !== version) fail(`the manifest is for ${manifest.version}, not ${version}`);

const assets = {};
for (const platform of PLATFORMS) {
  const asset = manifest.assets[platform];
  if (!asset) {
    console.warn(`pin-rune-engine: no ${platform} build; that platform keeps Electron`);
    continue;
  }
  if (typeof asset.url !== "string" || !/^[0-9a-f]{64}$/.test(asset.sha256 ?? "")) fail(`${platform} has no url or sha256`);
  if (verify) {
    const bytes = Buffer.from(await (await fetchOk(asset.url)).arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== asset.sha256) fail(`${platform}: ${asset.url} has sha256 ${sha256}, the manifest says ${asset.sha256}`);
    console.log(`${platform}: ${(bytes.length / 1048576).toFixed(1)} MiB, sha256 ok`);
  }
  const entry = { url: asset.url, sha256: asset.sha256 };
  if (asset.member) entry.member = asset.member;
  if (asset.app) entry.app = asset.app;
  assets[platform] = entry;
}
if (!Object.keys(assets).length) fail("the manifest has no assets");

const launcher = JSON.parse(readFileSync(launcherJson, "utf8"));
launcher.stellaEngine = { version: manifest.version, assets };
writeFileSync(launcherJson, `${JSON.stringify(launcher, null, 2)}\n`);
console.log(`Pinned stella-engine ${manifest.version} in packages/desktop/launcher.json (${Object.keys(assets).join(", ")}).`);
