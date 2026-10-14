import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DepTools } from "./tools.js";

export type DepBundle = {
  dir: string;
  entries: Map<string, string>;
};

const BUNDLE_FORMAT_VERSION = "1";
const FACADE_PREFIX = "\0stella-facade:";

const entryName = (file: string): string => {
  const marker = "/node_modules/";
  const normalized = file.replace(/\\/g, "/");
  const index = normalized.lastIndexOf(marker);
  const tail = index >= 0 ? normalized.slice(index + marker.length) : path.basename(file);
  const readable = tail.replace(/\.[cm]?js$/, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(-60);
  const digest = createHash("sha256").update(file).digest("hex").slice(0, 8);
  return `${readable}-${digest}`;
};

const hasModuleSyntax = (tools: DepTools, file: string): boolean => {
  if (file.endsWith(".mjs")) return true;
  if (file.endsWith(".cjs")) return false;
  try {
    return tools.parseSync(file, fs.readFileSync(file, "utf8")).module.hasModuleSyntax;
  } catch {
    return false;
  }
};

const commonJsExportNames = (
  tools: DepTools,
  file: string,
  seen = new Set<string>(),
): Set<string> => {
  const names = new Set<string>();
  if (seen.has(file)) return names;
  seen.add(file);
  let parsed: { exports: string[]; reexports: string[] };
  try {
    parsed = tools.parseCommonJs(fs.readFileSync(file, "utf8"));
  } catch {
    return names;
  }
  for (const name of parsed.exports) names.add(name);
  const requireFrom = createRequire(file);
  for (const target of parsed.reexports) {
    try {
      for (const name of commonJsExportNames(tools, requireFrom.resolve(target), seen)) {
        names.add(name);
      }
    } catch {
      // An unresolvable reexport just contributes nothing.
    }
  }
  return names;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(["default", "__esModule", "import", "export", "class", "function", "delete", "new", "this", "var", "let", "const", "enum", "await", "yield"]);

const facadeSource = (tools: DepTools, file: string): string => {
  const names = [...commonJsExportNames(tools, file)].filter(
    (name) => IDENTIFIER.test(name) && !RESERVED.has(name),
  );
  const target = JSON.stringify(file);
  return [
    `import * as namespace from ${target};`,
    `const mod = namespace.default ?? namespace;`,
    `export default mod;`,
    ...(names.length > 0 ? [`export const { ${names.join(", ")} } = mod;`] : []),
  ].join("\n");
};

export const fileDigest = (file: string): string => {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "missing";
  }
};

const building = new Map<string, Promise<DepBundle>>();

export const bundleDependencies = (options: {
  loadTools: () => Promise<DepTools>;
  files: Iterable<string>;
  cacheDir: string;
  lockfile: string;
  mode: string;
  log: (message: string) => void;
  apart?: boolean;
}): Promise<DepBundle> => {
  const files = [...new Set(options.files)].sort();
  const key = createHash("sha256")
    .update(
      JSON.stringify([BUNDLE_FORMAT_VERSION, options.mode, fileDigest(options.lockfile), files]),
    )
    .digest("hex")
    .slice(0, 16);
  const dir = path.join(options.cacheDir, "deps", key);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, string>;
    return Promise.resolve({ dir, entries: new Map(Object.entries(manifest)) });
  } catch {
    // Not built yet.
  }
  let build = building.get(dir);
  if (!build) {
    const request: DepsBuildRequest = { files, dir, mode: options.mode };
    const here = () => buildDependencyBundle({ ...request, loadTools: options.loadTools, log: options.log });
    build = (
      options.apart
        ? buildDependenciesApart(request, options.log).catch((error: unknown) => {
            options.log(`[deps] building apart failed, building here: ${error instanceof Error ? error.message : String(error)}`);
            return here();
          })
        : here()
    ).finally(() => building.delete(dir));
    building.set(dir, build);
  }
  return build;
};

export type DepsBuildRequest = { files: string[]; dir: string; mode: string };
const DEPS_BUILDER_URL = new URL("./deps-builder.js", import.meta.url);
const DEPS_BUILD_TIMEOUT_MS = 120_000;

/**
 * rolldown's allocator keeps a heap per pool thread (one per core by
 * default) and never returns a finished bundle's memory: about a gigabyte
 * on a 32-core machine, for the life of the process. Built in a child that
 * exits, it all goes back; the child also caps rolldown at 4 threads and
 * frees eagerly, which halves the peak at the same speed.
 */
const spawnBuilder = (): ChildProcessWithoutNullStreams =>
  spawn(process.execPath, [fileURLToPath(DEPS_BUILDER_URL)], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ROLLDOWN_WORKER_THREADS: "4",
      RAYON_NUM_THREADS: "4",
      MIMALLOC_PURGE_DELAY: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

let spare: ChildProcessWithoutNullStreams | null = null;

export const prewarmDependencyBuilder = () => {
  if (spare) return;
  try {
    const child = spawnBuilder();
    child.on("error", () => undefined);
    child.on("exit", () => {
      if (spare === child) spare = null;
    });
    spare = child;
  } catch {
    spare = null;
  }
};

export const releaseDependencyBuilder = () => {
  spare?.kill();
  spare = null;
};

const buildDependenciesApart = (
  request: DepsBuildRequest,
  log: (message: string) => void,
): Promise<DepBundle> =>
  new Promise((resolve, reject) => {
    const child = spare ?? spawnBuilder();
    spare = null;
    let stderr = "";
    let pending = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line) log(line);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    const timer = setTimeout(() => child.kill(), DEPS_BUILD_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (pending) log(pending);
      try {
        if (code !== 0) throw new Error(stderr.trim() || `exited with ${signal ?? code}`);
        const manifest = JSON.parse(fs.readFileSync(path.join(request.dir, "manifest.json"), "utf8")) as Record<string, string>;
        resolve({ dir: request.dir, entries: new Map(Object.entries(manifest)) });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });

export const buildDependencyBundle = async (
  options: DepsBuildRequest & {
    loadTools: () => Promise<DepTools>;
    log: (message: string) => void;
  },
): Promise<DepBundle> => {
  const { files, dir } = options;
  const tools = await options.loadTools();
  const startedAt = Date.now();
  const entries = new Map<string, string>();
  const input: Record<string, string> = {};
  const facades = new Map<string, string>();
  for (const file of files) {
    const name = entryName(file);
    entries.set(file, `${name}.js`);
    if (hasModuleSyntax(tools, file)) {
      input[name] = file;
    } else {
      input[name] = `${FACADE_PREFIX}${file}`;
      facades.set(`${FACADE_PREFIX}${file}`, facadeSource(tools, file));
    }
  }

  const staging = `${dir}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  const bundle = await tools.rolldown({
    input,
    platform: "browser",
    transform: {
      define: {
        "process.env.NODE_ENV": JSON.stringify(options.mode === "production" ? "production" : "development"),
        global: "globalThis",
      },
    },
    plugins: [
      {
        name: "stella-cjs-facades",
        resolveId: (id) => (facades.has(id) ? id : null),
        load: (id) => facades.get(id) ?? null,
      },
    ],
    onLog: (level, log) => {
      if (level === "warn" && log.code === "IMPORT_IS_UNDEFINED") return;
      if (level === "warn" || level === "info") return;
      options.log(`[deps] ${log.message}`);
    },
  });
  try {
    await bundle.write({
      dir: staging,
      format: "esm",
      entryFileNames: "[name].js",
      chunkFileNames: "chunk-[hash].js",
      assetFileNames: "asset-[hash][extname]",
    });
  } finally {
    await bundle.close();
  }
  fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify(Object.fromEntries(entries)));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(staging, dir);
  options.log(`[deps] bundled ${files.length} dependencies in ${Date.now() - startedAt}ms`);
  return { dir, entries };
};
