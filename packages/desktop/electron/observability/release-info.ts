import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { gitRaw } from "../services/app-source/git.js";

const RELEASE_LABEL = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;
const UPSTREAM_REF = "refs/remotes/stella-upstream/main";
const LAUNCHER_LOG_TAIL_BYTES = 1024 * 1024;

const publishedSource = async (appDir: string | null | undefined): Promise<string | null> => {
  if (!appDir) return null;
  const result = await gitRaw(appDir, ["merge-base", "HEAD", UPSTREAM_REF], {
    background: true,
    timeoutMs: 10_000,
  }).catch(() => null);
  const commit = result?.code === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{40,64}$/.test(commit) ? commit.slice(0, 12) : null;
};

const launcherVersion = async (): Promise<string | null> => {
  const fromEnv = process.env.STELLA_LAUNCHER_VERSION?.trim();
  if (fromEnv && /^\d{1,9}$/.test(fromEnv)) return fromEnv;
  const root = process.env.STELLA_LAUNCHER_DATA_DIR?.trim();
  if (!root) return null;
  const file = await open(path.join(root, "logs", "launcher.log"), "r").catch(() => null);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const length = Math.min(size, LAUNCHER_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    const starts = [...buffer.toString("utf8").matchAll(/launcher: start .*?\bversion=(\d{1,9})\b/g)];
    return starts.at(-1)?.[1] ?? null;
  } catch {
    return null;
  } finally {
    await file.close().catch(() => {});
  }
};

/**
 * `<app version>+s<published Stella>.l<launcher>`, for example
 * `0.0.0+s94e565cd5882.l85`: semver build metadata, so the telemetry worker's
 * release check and column take it as they are. Parts that can't be found
 * are left out.
 */
export const releaseLabel = async (appDir: string | null | undefined): Promise<string> => {
  const version = app.getVersion();
  const base = RELEASE_LABEL.test(version) && !version.includes("+") ? version : "unknown";
  const [source, launcher] = await Promise.all([publishedSource(appDir), launcherVersion()]);
  const build = [source && `s${source}`, launcher && `l${launcher}`].filter(Boolean);
  const label = build.length ? `${base}+${build.join(".")}` : base;
  return RELEASE_LABEL.test(label) ? label : base;
};

const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export const osLabel = (): string => {
  const name = OS_NAMES[process.platform] ?? process.platform;
  const version = process.platform === "linux" ? os.release() : process.getSystemVersion();
  return `${name} ${version} (${process.arch})`;
};
