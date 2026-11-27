import { spawn, spawnSync } from "node:child_process";
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  mkdirSync,
  promises as fsPromises,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";
import { usesSignedElectron } from "./tidy-packages.mjs";

// Electron's own postinstall (`node_modules/electron/install.js`) downloads the
// binary fine but extracts it with `extract-zip`, which can die silently
// mid-extraction on newer Node versions -- leaving a half-written
// `dist/Electron.app` and no `path.txt`, so `require('electron')` throws ENOENT.
// This guard verifies the install and, when broken, re-extracts the already
// cached zip with native OS tooling instead of trusting `extract-zip`.

const scriptDir = import.meta.dirname;
const repoRootDir = path.resolve(scriptDir, "..", "..", "..");
const electronDir = path.join(repoRootDir, "node_modules", "electron");

function log(message) {
  console.log(`[ensure-electron-binary] ${message}`);
}

function getPlatformPath(platform) {
  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    case "win32":
      return "electron.exe";
    default:
      throw new Error(
        `Electron builds are not available on platform: ${platform}`,
      );
  }
}

export function readElectronVersion() {
  const pkg = JSON.parse(
    readFileSync(path.join(electronDir, "package.json"), "utf8"),
  );
  return pkg.version;
}

export function isElectronBinaryHealthy() {
  if (!existsSync(electronDir)) {
    return true;
  }

  try {
    const version = readElectronVersion();

    const installedVersion = readFileSync(
      path.join(electronDir, "dist", "version"),
      "utf8",
    )
      .trim()
      .replace(/^v/, "");
    if (installedVersion !== version) {
      return false;
    }

    const recordedPath = readFileSync(
      path.join(electronDir, "path.txt"),
      "utf8",
    ).trim();
    if (!recordedPath) {
      return false;
    }

    return existsSync(path.join(electronDir, "dist", recordedPath));
  } catch {
    return false;
  }
}

const DEFAULT_RELEASES_URL = "https://dl.stella.sh";
const ELECTRON_GITHUB = "https://github.com/electron/electron/releases/download/";

// Stella's mirror of Electron's GitHub releases first, then GitHub itself.
export function electronMirrors() {
  const releases = (process.env.STELLA_RELEASES_URL || DEFAULT_RELEASES_URL).replace(/\/+$/, "");
  return [`${releases}/runtimes/github/electron/electron/releases/download/`, ELECTRON_GITHUB];
}

// GitHub release downloads answer 502/504 or time out for minutes at a time,
// so Electron comes from Stella's mirror of that release path first
// (scripts/mirror-runtimes.mjs), then from GitHub, for a few rounds with a
// growing pause. checksums.json verifies the zip from either source.
async function downloadElectronZip(downloadArtifact, details) {
  const mirrors = electronMirrors();
  let lastError;
  for (const pauseSeconds of [0, 5, 15, 30]) {
    if (pauseSeconds) {
      log(`Electron download failed (${lastError?.message ?? lastError}); trying again in ${pauseSeconds}s`);
      await new Promise((resolve) => setTimeout(resolve, pauseSeconds * 1000));
    }
    for (const mirror of mirrors) {
      try {
        return await downloadArtifact({ ...details, mirrorOptions: { mirror } });
      } catch (error) {
        lastError = error;
        log(`Electron download from ${mirror} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw lastError;
}

export function resolveDownloadArch() {
  let arch =
    process.env.ELECTRON_INSTALL_ARCH ||
    process.env.npm_config_arch ||
    process.arch;

  if (
    process.platform === "darwin" &&
    arch === "x64" &&
    process.env.npm_config_arch === undefined
  ) {
    // Match Electron's installer: a Rosetta-translated x64 Node should still
    // pull the arm64 binary.
    try {
      const output = spawnSync("sysctl", ["-in", "sysctl.proc_translated"], {
        encoding: "utf8",
      });
      if (output.status === 0 && output.stdout.trim() === "1") {
        arch = "arm64";
      }
    } catch {}
  }

  return arch;
}

function zipExtractors(zipPath, distDir) {
  const attempts =
    process.platform === "darwin"
      ? [["ditto", ["-x", "-k", zipPath, distDir]]]
      : process.platform === "win32"
        ? [
            ["tar", ["-xf", zipPath, "-C", distDir]],
            [
              "powershell.exe",
              [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force`,
              ],
            ],
          ]
        : [
            ["unzip", ["-q", "-o", zipPath, "-d", distDir]],
            ["tar", ["-xf", zipPath, "-C", distDir]],
          ];

  // Windows PowerShell 5.1 started from PowerShell 7 inherits its module path
  // and loads 7's Expand-Archive, which fails; give it its own.
  const env = { ...process.env };
  if (process.platform === "win32") {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === "psmodulepath") delete env[key];
    }
  }
  return { attempts, env };
}

export function extractZipNatively(zipPath, distDir) {
  rmSync(distDir, { force: true, recursive: true });
  mkdirSync(distDir, { recursive: true });
  const { attempts, env } = zipExtractors(zipPath, distDir);

  let lastError = "no extraction tool succeeded";
  for (const [command, args] of attempts) {
    const result = spawnSync(command, args, { stdio: "ignore", env });
    if (!result.error && result.status === 0) {
      return;
    }
    lastError = result.error
      ? result.error.message
      : `${command} exited with code ${result.status}`;
  }

  throw new Error(`Failed to extract Electron zip: ${lastError}`);
}

// The same, without blocking the caller's event loop.
export async function extractZipNativelyAsync(zipPath, distDir) {
  rmSync(distDir, { force: true, recursive: true });
  mkdirSync(distDir, { recursive: true });
  const { attempts, env } = zipExtractors(zipPath, distDir);

  let lastError = "no extraction tool succeeded";
  for (const [command, args] of attempts) {
    const outcome = await new Promise((resolve) => {
      const child = spawn(command, args, { stdio: "ignore", env });
      child.once("error", (error) => resolve(error.message));
      child.once("close", (status) => resolve(status === 0 ? null : `${command} exited with code ${status}`));
    });
    if (!outcome) return;
    lastError = outcome;
  }

  throw new Error(`Failed to extract Electron zip: ${lastError}`);
}

function canCloneBetween(fromFile, toDir) {
  const probe = path.join(toDir, `.clone-probe-${process.pid}`);
  try {
    copyFileSync(fromFile, probe, fsConstants.COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { force: true });
  }
}

// fs.cpSync ignores the clone flag and copies bytes, so walk the tree.
function cloneTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), target);
    } else if (entry.isDirectory()) {
      cloneTree(source, target);
    } else {
      copyFileSync(source, target, fsConstants.COPYFILE_FICLONE_FORCE);
    }
  }
}

function cloneSharedDist(zipPath, distDir, platformPath) {
  if (process.platform === "win32") return false;
  const parent = path.dirname(distDir);
  if (!canCloneBetween(zipPath, parent)) return false;

  const shared = `${zipPath}.unpacked`;
  if (!existsSync(path.join(shared, platformPath))) {
    const staging = `${shared}.${process.pid}`;
    extractZipNatively(zipPath, staging);
    try {
      renameSync(staging, shared);
    } catch {
      rmSync(staging, { force: true, recursive: true });
    }
    if (!existsSync(path.join(shared, platformPath))) return false;
  }

  rmSync(distDir, { force: true, recursive: true });
  try {
    cloneTree(shared, distDir);
    return true;
  } catch {
    rmSync(distDir, { force: true, recursive: true });
    return false;
  }
}

// Unpacks a downloaded Electron zip into node_modules/electron/dist and
// records path.txt, as Electron's own installer would.
// `shared: false` skips the copy-on-write clone for a zip that is about to be
// deleted.
export async function installElectronZip(
  zipPath,
  platform = process.platform,
  { shared = true } = {},
) {
  const platformPath = getPlatformPath(platform);
  // node_modules/electron is a link into bun's store. Windows' tar.exe
  // (November 2026 and later) refuses to extract through it ("too many
  // symbolic link levels"), so write into the store folder itself.
  const distDir = path.join(realpathSync(electronDir), "dist");
  if (shared && cloneSharedDist(zipPath, distDir, platformPath)) {
    log("Cloned the shared unpacked Electron (copy-on-write).");
  } else {
    extractZipNatively(zipPath, distDir);
  }
  await finishElectronDist(distDir, platformPath);
}

// Moves an Electron zip already unpacked into `unpackedDir` (on the same
// volume as node_modules) into place.
export async function adoptUnpackedElectron(unpackedDir, platform = process.platform) {
  const platformPath = getPlatformPath(platform);
  if (!existsSync(path.join(unpackedDir, platformPath))) {
    throw new Error(`${unpackedDir} has no ${platformPath}`);
  }
  const distDir = path.join(realpathSync(electronDir), "dist");
  rmSync(distDir, { force: true, recursive: true });
  renameSync(unpackedDir, distDir);
  await finishElectronDist(distDir, platformPath);
}

async function finishElectronDist(distDir, platformPath) {
  const srcTypeDefPath = path.join(distDir, "electron.d.ts");
  if (existsSync(srcTypeDefPath)) {
    renameSync(srcTypeDefPath, path.join(electronDir, "electron.d.ts"));
  }

  await fsPromises.writeFile(path.join(electronDir, "path.txt"), platformPath);

  if (!isElectronBinaryHealthy()) {
    throw new Error(
      "Electron binary still looks incomplete after re-extraction.",
    );
  }
}

export async function ensureElectronBinary() {
  if (usesSignedElectron(repoRootDir)) {
    return;
  }
  if (isElectronBinaryHealthy()) {
    return;
  }

  if (!existsSync(electronDir)) {
    return;
  }

  log("Electron binary is missing or incomplete; repairing...");

  const require = createRequire(import.meta.url);
  // Bun may keep Electron's dependencies beside the package in its virtual
  // store instead of hoisting them to the workspace root. Resolve from the
  // real Electron package location so @electron/get remains reachable there.
  const electronRequire = createRequire(
    require.resolve("electron/package.json"),
  );
  const { downloadArtifact } = electronRequire("@electron/get");

  const version = readElectronVersion();
  const platform =
    process.env.ELECTRON_INSTALL_PLATFORM ||
    process.env.npm_config_platform ||
    process.platform;
  const arch = resolveDownloadArch();

  let checksums;
  try {
    checksums = require(path.join(electronDir, "checksums.json"));
  } catch {
    checksums = undefined;
  }

  const zipPath = await downloadElectronZip(downloadArtifact, {
    version,
    artifactName: "electron",
    force: false,
    checksums,
    platform,
    arch,
  });

  await installElectronZip(zipPath, platform);

  log(`Repaired Electron ${version} (${platform}/${arch}).`);
}

if (isEntryPoint(import.meta.url)) {
  ensureElectronBinary().catch((error) => {
    console.error(
      `[ensure-electron-binary] ${error instanceof Error ? error.stack || error.message : String(error)}`,
    );
    process.exit(1);
  });
}
