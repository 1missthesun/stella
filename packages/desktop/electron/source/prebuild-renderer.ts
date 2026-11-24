import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prebuiltRendererDirFor } from "./prebuilt-cache.js";
import { createRendererSource } from "./renderer-source.js";

export type PrebuildRendererResult = {
  skipped: boolean;
  cacheDir: string;
  pages: string[];
  modules: number;
  deps: number;
  ms: number;
};

type PrebuildStamp = {
  version: number;
  head: string;
  pages: string[];
  modules: number;
  deps: number;
  builtAt: string;
};

const STAMP_VERSION = 1;
const RENDERER_GIT_PATHS = [
  "packages/desktop-ui",
  "packages/contracts",
  "packages/theme",
  "packages/model-catalog",
  "bun.lock",
];

const gitOutput = (repoRoot: string, args: string[]): string | null => {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
};

const readStamp = (stampPath: string): PrebuildStamp | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(stampPath, "utf8")) as PrebuildStamp;
    return parsed && parsed.version === STAMP_VERSION ? parsed : null;
  } catch {
    return null;
  }
};

const hasBundleFiles = (cacheDir: string, pages: string[]): boolean => {
  if (pages.length === 0) return false;
  const bundlesDir = path.join(cacheDir, "bundles");
  let entries: string[];
  try {
    entries = fs.readdirSync(bundlesDir);
  } catch {
    return false;
  }
  return pages.every((page) => {
    const prefix = `${page.replace(/\.html$/, "").replace(/[^a-z0-9]/gi, "_")}-`;
    return (
      entries.some((name) => name.startsWith(prefix) && name.endsWith(".js")) &&
      entries.some((name) => name.startsWith(prefix) && name.endsWith(".json"))
    );
  });
};

const pruneStaleDepDirs = async (cacheDir: string, keepDir: string | null): Promise<void> => {
  if (!keepDir) return;
  const keepName = path.basename(keepDir);
  const depsRoot = path.join(cacheDir, "deps");
  const names = await fs.promises.readdir(depsRoot).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name !== keepName)
      .map((name) => fs.promises.rm(path.join(depsRoot, name), { recursive: true, force: true }).catch(() => undefined)),
  );
};

export const prebuildDesktopRenderer = async (options: {
  repoRoot: string;
  force?: boolean;
  log?: (message: string) => void;
}): Promise<PrebuildRendererResult> => {
  const startedAt = Date.now();
  const { repoRoot, force = false } = options;
  const log = options.log ?? ((message: string) => console.log(message));
  const cacheDir = prebuiltRendererDirFor(repoRoot);
  const stampPath = path.join(cacheDir, "stamp.json");
  const head = gitOutput(repoRoot, ["rev-parse", "HEAD"]) ?? "";
  const status = head
    ? gitOutput(repoRoot, ["status", "--porcelain", "--", ...RENDERER_GIT_PATHS])
    : null;
  const cleanTree = Boolean(head) && status === "";

  if (!force && cleanTree) {
    const existing = readStamp(stampPath);
    if (existing && existing.head === head && hasBundleFiles(cacheDir, existing.pages)) {
      log(`[prebuild-renderer] already prepared for ${head.slice(0, 12)}`);
      return {
        skipped: true,
        cacheDir,
        pages: existing.pages,
        modules: existing.modules,
        deps: existing.deps,
        ms: Date.now() - startedAt,
      };
    }
  }

  if (force) {
    await fs.promises.rm(cacheDir, { recursive: true, force: true });
  }
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const uiRoot = path.join(repoRoot, "packages", "desktop-ui");
  const source = await createRendererSource({
    uiRoot,
    repoRoot,
    envDir: uiRoot,
    cacheDir,
    mode: "production",
    log,
    onReloadNeeded: () => undefined,
    apart: false,
    skipAutoBundle: true,
    skipPrewarm: true,
    tailwindWarmDelayMs: 0,
  });

  try {
    const built = await source.prebuild();
    await pruneStaleDepDirs(cacheDir, built.depsDir);
    if (cleanTree && head) {
      const stamp: PrebuildStamp = {
        version: STAMP_VERSION,
        head,
        pages: built.pages,
        modules: built.modules,
        deps: built.deps,
        builtAt: new Date().toISOString(),
      };
      await fs.promises.writeFile(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
    } else {
      await fs.promises.rm(stampPath, { force: true }).catch(() => undefined);
    }
    const ms = Date.now() - startedAt;
    log(
      `[prebuild-renderer] prepared ${built.pages.length} pages (${built.modules} modules, ${built.deps} deps) in ${ms}ms`,
    );
    return {
      skipped: false,
      cacheDir,
      pages: built.pages,
      modules: built.modules,
      deps: built.deps,
      ms,
    };
  } finally {
    source.dispose();
  }
};
