import fs from "node:fs";
import path from "node:path";

export const PREBUILT_RENDERER_REL = path.join("packages", "desktop", ".prebuilt-renderer");

export const prebuiltRendererDirFor = (repoRoot: string): string =>
  path.join(repoRoot, PREBUILT_RENDERER_REL);

export const resolvePrebuiltRendererDir = (
  repoRoot: string,
  cacheDir: string,
): string | undefined => {
  const dir = prebuiltRendererDirFor(repoRoot);
  if (path.resolve(dir) === path.resolve(cacheDir)) return undefined;
  try {
    return fs.statSync(dir).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
};
