import {
  enableCompileCache,
  flushCompileCache,
  getCompileCacheDir,
} from "node:module";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const COMPILE_CACHE_FLUSH_DELAY_MS = 15_000;
const COMPILE_CACHE_DIR_NAME = "Main Compile Cache";

const enableMainCompileCache = (): void => {
  try {
    // Node's default temp location, in every install. Stella's own userData
    // would survive temp cleaners, but this module runs before the bundle it
    // loads, and it is that bundle (bootstrap) which renames the app and points
    // userData at Stella's profile: `app.getPath("userData")` here is still the
    // pre-rename default and would plant a stray profile directory. This was an
    // `app.isPackaged` branch that no install has taken since packaging was
    // removed; moving the cache needs a path the launcher hands us, and this
    // module may not import one to derive it (electron/launch.js must inline
    // nothing — see assertMainBundleStartupBoundary).
    enableCompileCache();
  } catch {
    // Startup must never depend on the cache.
  }
};

const pruneStaleCompileCacheVersions = async (activeDir: string) => {
  const root = path.dirname(activeDir);
  if (path.basename(root) !== COMPILE_CACHE_DIR_NAME) {
    return;
  }
  const activeName = path.basename(activeDir);
  const entries = await readdir(root);
  await Promise.all(
    entries
      .filter((entry) => entry !== activeName)
      .map((entry) =>
        rm(path.join(root, entry), { recursive: true, force: true }),
      ),
  );
};

enableMainCompileCache();

// Electron holds `ready` until an ESM entry, including its top-level await,
// has finished evaluating, so awaiting the bundle here keeps the ordering of
// loading it directly: its top level still runs entirely before `ready`.
// The specifier is computed so esbuild leaves the bundle as a separate file.
await import(new URL("./main.js", import.meta.url).href);

const compileCacheDir = getCompileCacheDir();
if (compileCacheDir) {
  setTimeout(() => {
    try {
      flushCompileCache();
    } catch {
      // Best-effort; Node also persists pending entries at exit.
    }
    void pruneStaleCompileCacheVersions(compileCacheDir).catch(() => {});
  }, COMPILE_CACHE_FLUSH_DELAY_MS).unref();
}
