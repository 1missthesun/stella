import { existsSync } from "node:fs";
import path from "node:path";
import {
  checkRuntimeBytecode,
  runtimeSourceEntryPath,
  type RuntimeBytecodeVerdict,
} from "./runtime-bytecode.js";

const moduleDir = import.meta.dirname;

let cachedRoot: string | null = null;

export function getStellaAppDir(): string {
  if (cachedRoot) return cachedRoot;

  const fromEnv = process.env.STELLA_APP_DIR?.trim();
  if (fromEnv) {
    cachedRoot = fromEnv;
    return cachedRoot;
  }

  let dir = moduleDir;
  for (let i = 0; i < 16; i += 1) {
    if (
      existsSync(path.join(dir, "package.json")) &&
      existsSync(path.join(dir, "packages", "runtime"))
    ) {
      cachedRoot = dir;
      return cachedRoot;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Last resort: assume the canonical source layout
  // (<root>/packages/runtime/kernel/shared -> <root>).
  cachedRoot = path.resolve(moduleDir, "..", "..", "..", "..");
  return cachedRoot;
}

/**
 * Resolve a data asset that ships in the repo's source tree under `packages/runtime/`
 * (e.g. the OAuth catalog JSON, bundled agent markdown). The STELLA_APP_DIR path
 * is canonical; the packaging build's copy under `packages/desktop/dist-electron/` is a fallback
 * for callers that only see the bundled tree.
 */
export function resolveRuntimeSourceAsset(...segments: string[]): string {
  const root = getStellaAppDir();
  const resourcesPath = process.env.STELLA_APP_RESOURCES_PATH?.trim();
  const candidates = [
    ...(resourcesPath
      ? [path.join(resourcesPath, "runtime", ...segments)]
      : []),
    path.join(root, "packages", "runtime", ...segments),
    path.join(root, "packages", "desktop", "dist-electron", "runtime", ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Resolve a runtime file the app spawns by path (the worker entry, sidecar
 * CLIs). A source tree runs it as TypeScript under Bun, so the `.ts` source
 * comes first; a packaged app has no runtime source and uses its bundled copy
 * under `STELLA_APP_RESOURCES_PATH`, and `dist-electron/runtime/` (the
 * packaging build) is the last resort. Anchored on STELLA_APP_DIR rather than
 * this module's `import.meta`, which moves when esbuild inlines it.
 *
 * @param relativeToRuntimeRoot e.g. "worker/entry.js" or "kernel/cli/foo.js"
 */
export function resolveBundledRuntimeFile(relativeToRuntimeRoot: string): string {
  const root = getStellaAppDir();
  const resourcesPath = process.env.STELLA_APP_RESOURCES_PATH?.trim();
  const segments = relativeToRuntimeRoot.replace(/\\/g, "/").split("/");
  const sourceSegments = segments.map((segment, index) =>
    index === segments.length - 1 ? segment.replace(/\.js$/, ".ts") : segment,
  );
  const candidates = [
    path.join(root, "packages", "runtime", ...sourceSegments),
    ...(resourcesPath
      ? [path.join(resourcesPath, "runtime", ...segments)]
      : []),
    path.join(root, "packages", "desktop", "dist-electron", "runtime", ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * The entry to spawn a runtime worker with. A source checkout runs the
 * bytecode build of its worker when one matches the tree exactly (see
 * `runtime-bytecode.ts`), else the TypeScript source; `bytecode` says which
 * and why, so the caller can ask for a build. Other layouts resolve as
 * `resolveBundledRuntimeFile("worker/entry.js")`.
 */
export function resolveRuntimeWorkerEntry(options?: {
  bunBinaryPath?: string;
}): { path: string; bytecode: RuntimeBytecodeVerdict | null } {
  const root = getStellaAppDir();
  const source = runtimeSourceEntryPath(root);
  if (!existsSync(source)) {
    return { path: resolveBundledRuntimeFile("worker/entry.js"), bytecode: null };
  }
  const bytecode = checkRuntimeBytecode(root, options?.bunBinaryPath);
  return { path: bytecode.usable ? bytecode.loaderPath : source, bytecode };
}
