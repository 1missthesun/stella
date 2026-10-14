#!/usr/bin/env node

import { spawn } from "child_process";
import {
  existsSync,
  accessSync,
  chmodSync,
  constants,
  renameSync,
  rmSync,
} from "fs";
import { join } from "path";
import { platform, arch } from "os";

const __dirname = import.meta.dirname;

function getPlatformKey() {
  const os = platform();
  const cpuArch = arch();
  const osKey = os === "win32" ? "win" : os;
  const archKey =
    cpuArch === "x86_64" ? "x64" : cpuArch === "aarch64" ? "arm64" : cpuArch;
  if (
    !["darwin", "linux", "win"].includes(osKey) ||
    !["x64", "arm64"].includes(archKey)
  ) {
    return null;
  }
  return `${osKey}-${archKey}`;
}

function promoteStagedBinary(binaryPath) {
  const stagedPath = `${binaryPath}.update`;
  if (!existsSync(stagedPath)) return;
  const previousPath = `${binaryPath}.previous`;
  try {
    rmSync(previousPath, { force: true });
    if (existsSync(binaryPath)) renameSync(binaryPath, previousPath);
    renameSync(stagedPath, binaryPath);
    rmSync(previousPath, { force: true });
  } catch (error) {
    if (!existsSync(binaryPath) && existsSync(previousPath)) {
      try {
        renameSync(previousPath, binaryPath);
      } catch {
        // Keep the original error; startup cannot proceed without a binary.
      }
    }
    console.error(
      `Error: Cannot activate browser service update: ${error.message}`,
    );
    process.exit(1);
  }
}

function resolveBinaryPath() {
  const forcedBinaryPath = process.env.STELLA_BROWSER_BINARY_PATH;
  if (forcedBinaryPath) {
    return forcedBinaryPath;
  }

  const platformKey = getPlatformKey();
  const hydratedName =
    platform() === "win32" ? "stella-browser.exe" : "stella-browser";
  if (!platformKey) return null;
  const hydratedPath = join(__dirname, "..", "out", platformKey, hydratedName);
  promoteStagedBinary(hydratedPath);
  return hydratedPath;
}

function main() {
  const binaryPath = resolveBinaryPath();

  if (!binaryPath) {
    console.error(`Error: Unsupported platform: ${platform()}-${arch()}`);
    process.exit(1);
  }

  if (!existsSync(binaryPath)) {
    console.error(`Error: No binary found for ${platform()}-${arch()}`);
    console.error(`Expected: ${binaryPath}`);
    console.error("");
    console.error('Run "npm run build:native" to build for your platform,');
    console.error(
      "or reinstall the package to trigger the postinstall download.",
    );
    process.exit(1);
  }

  // Ensure binary is executable (fixes EACCES on macOS/Linux when postinstall didn't run,
  // e.g., when using bun which blocks lifecycle scripts by default)
  if (platform() !== "win32") {
    try {
      accessSync(binaryPath, constants.X_OK);
    } catch {
      try {
        chmodSync(binaryPath, 0o755);
      } catch (chmodErr) {
        console.error(
          `Error: Cannot make binary executable: ${chmodErr.message}`,
        );
        console.error("Try running: chmod +x " + binaryPath);
        process.exit(1);
      }
    }
  }

  const child = spawn(binaryPath, process.argv.slice(2), {
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
  });

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  child.on("error", (err) => {
    console.error(`Error executing binary: ${err.message}`);
    process.exit(1);
  });

  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

main();
