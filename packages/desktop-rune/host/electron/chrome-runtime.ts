// The Chrome Stella downloads when the computer has none, the way the launchers install Bun and
// the engine: a pinned Chrome for Testing archive, checked against its sha256 and unpacked into
// `<launcher root>/runtimes/chrome-<version>/` on first use. Electron ships its own Chromium; this
// is Rune's stand-in for it (the in-app browser, agent browsing, Linux voice).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractZip } from "./zip";

const CHROME = {
  version: "158.0.8127.88",
  assets: {
    "linux-x64": { url: "https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.88/linux64/chrome-linux64.zip", sha256: "59e3b43f8b3aaa292238fbdcfb36a93127debd53e212510dcdc2cc8812b4b57e", binary: "chrome-linux64/chrome" },
    "linux-arm64": { url: "https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.88/linux-arm64/chrome-linux-arm64.zip", sha256: "91669b5de79af808d498037dd974e4b09461776a1b5240b3bb656abd17e5d3ab", binary: "chrome-linux-arm64/chrome" },
    "darwin-arm64": { url: "https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.88/mac-arm64/chrome-mac-arm64.zip", sha256: "6caf16b007aafaf6d4a4db252262be8ebbf0d91a2af005257e388996dbe463d6", binary: "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" },
    "darwin-x64": { url: "https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.88/mac-x64/chrome-mac-x64.zip", sha256: "4529a2bdbea10cf69f79b8b0ff43a5a23e8dc8b033da85cbe873afb81855579a", binary: "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" },
    "win32-x64": { url: "https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.88/win64/chrome-win64.zip", sha256: "fda73ca9ffc7f02c5c85165cb472152540a76a7cecd8ec11314ea781e4454109", binary: "chrome-win64/chrome.exe" },
  } as Record<string, { url: string; sha256: string; binary: string }>,
};

const asset = CHROME.assets[`${process.platform}-${process.arch}`] ?? null;

/** The launcher's install root (it passes it as STELLA_LAUNCHER_DATA_DIR), else where it would be. */
export function stellaRuntimesDir(): string {
  const launcherRoot = process.env.STELLA_LAUNCHER_DATA_DIR?.trim();
  if (launcherRoot) return path.join(launcherRoot, "runtimes");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library/Application Support/Stella/runtimes");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"), "Stella/runtimes");
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return path.join(xdg || path.join(os.homedir(), ".local/share"), "stella/runtimes");
}

const installDir = () => path.join(stellaRuntimesDir(), `chrome-${CHROME.version}`);

/** The downloaded Chrome, if it is installed. */
export function managedChrome(): string | null {
  if (!asset) return null;
  const binary = path.join(installDir(), asset.binary);
  return existsSync(binary) ? binary : null;
}

export const managedChromeAvailable = () => asset !== null;

let installing: Promise<string> | null = null;

/** The downloaded Chrome, downloading and unpacking it first if needed. */
export function installManagedChrome(): Promise<string> {
  const ready = managedChrome();
  if (ready) return Promise.resolve(ready);
  if (!asset) return Promise.reject(new Error(`No Chrome download for ${process.platform}-${process.arch}.`));
  installing ??= install(asset).finally(() => { installing = null; });
  return installing;
}

async function install(entry: { url: string; sha256: string; binary: string }): Promise<string> {
  const runtimes = stellaRuntimesDir();
  const archive = path.join(runtimes, `.chrome-${CHROME.version}.download`);
  const staging = path.join(runtimes, `.chrome-${CHROME.version}.partial`);
  await mkdir(runtimes, { recursive: true });
  const started = Date.now();
  console.error(`[chrome] downloading Chrome for Testing ${CHROME.version} from ${entry.url}`);
  try {
    const response = await fetch(entry.url);
    if (!response.ok || !response.body) throw new Error(`Chrome download failed: HTTP ${response.status}`);
    const hash = createHash("sha256");
    const sink = Bun.file(archive).writer();
    for await (const chunk of response.body) {
      hash.update(chunk);
      sink.write(chunk);
      await sink.flush();
    }
    await sink.end();
    const actual = hash.digest("hex");
    if (actual !== entry.sha256) throw new Error(`Chrome download checksum mismatch: expected ${entry.sha256}, got ${actual}`);
    await rm(staging, { recursive: true, force: true });
    await extractZip(archive, staging);
    if (!existsSync(path.join(staging, entry.binary))) throw new Error(`Chrome archive has no ${entry.binary}`);
    await rm(installDir(), { recursive: true, force: true });
    await rename(staging, installDir());
    console.error(`[chrome] Chrome for Testing ${CHROME.version} ready in ${Date.now() - started} ms at ${installDir()}`);
    return path.join(installDir(), entry.binary);
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
