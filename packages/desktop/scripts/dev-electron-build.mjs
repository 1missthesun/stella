import {
  build as runEsbuildBuild,
  stop as stopEsbuildService,
  transform as transformWithEsbuild,
} from "esbuild";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  promises as fsPromises,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { isEntryPoint } from "../../../scripts/lib/entry-point.mjs";

const scriptDir = import.meta.dirname;
const desktopDir = path.resolve(scriptDir, "..");
const repoRootDir = path.resolve(desktopDir, "..", "..");
const outdir = "dist-electron";
const nodeTarget = `node${process.versions.node.split(".")[0]}`;
const splitMainEntryPoints = {
  "electron/main": "packages/desktop/electron/main.ts",
};
const MAIN_CHUNK_NAMES = "electron/chunk-[hash]";
const MAIN_CHUNK_FILE = /^chunk-[A-Z0-9]+\.js$/;
const electronMainEntryPoints = {
  "electron/launch": "packages/desktop/electron/launch.ts",
  "electron/cloud-conversation-cache-worker": "packages/desktop/electron/services/cloud-conversation-cache-worker.ts",
  "electron/source-worker": "packages/desktop/electron/source/source-worker.ts",
  "electron/tailwind-worker": "packages/desktop/electron/source/tailwind-worker.ts",
  "electron/deps-builder": "packages/desktop/electron/source/deps-builder.ts",
};
const preloadEntryPoints = {
  "electron/preload": "packages/desktop/electron/preload.ts",
  "electron/offscreen-tab-mirror-preload":
    "packages/desktop/electron/offscreen-tab-mirror-preload.ts",
};
const desktopUiDir = path.join(repoRootDir, "packages", "desktop-ui");
const desktopEnvFiles = (mode) => [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
const desktopPublicEnv = {};
for (const name of desktopEnvFiles(process.env.NODE_ENV || "development")) {
  try {
    Object.assign(desktopPublicEnv, parseEnv(readFileSync(path.join(desktopUiDir, name), "utf8")));
  } catch {}
}
const publicTurnstileSiteKey =
  process.env.VITE_TURNSTILE_SITE_KEY ||
  desktopPublicEnv.VITE_TURNSTILE_SITE_KEY ||
  "";

const rendererSourceExternals = [
  "rolldown",
  "rolldown/*",
  "@tailwindcss/node",
  "@tailwindcss/oxide",
  "@tanstack/router-generator",
  "cjs-module-lexer",
];

export const mainRuntimeBridgeFiles = [
  "packages/runtime/host/client-protocol.ts",
  "packages/runtime/host/effect-runtime.ts",
  "packages/runtime/host/lifecycle.ts",
  "packages/runtime/host/lifecycle/",
  "packages/runtime/host/remote.ts",
  "packages/runtime/host/runtime-bytecode-build.ts",
  "packages/runtime/kernel/shared/runtime-bytecode.ts",
  "packages/runtime/kernel/shared/runtime-paths.ts",
  "packages/runtime/observability/rotate-file.ts",
  "packages/runtime/worker/effect-lazy.ts",
  "packages/runtime/worker/effect-runtime.ts",
  "packages/runtime/worker/lifecycle-server.ts",
  "packages/runtime/worker/runtime-auth.ts",
  "packages/runtime/worker/server-identity.ts",
];

const isMainRuntimeBridgeInput = (input) =>
  mainRuntimeBridgeFiles.some((file) =>
    file.endsWith("/") ? input.startsWith(file) : input === file,
  );

export const assertMainBundleRuntimeBoundary = (metafile) => {
  const outside = Object.keys(metafile?.inputs ?? {})
    .map((input) => toPosix(input))
    .filter(
      (input) =>
        input.startsWith("packages/agent/") ||
        (input.startsWith("packages/runtime/") && !isMainRuntimeBridgeInput(input)),
    );
  if (outside.length > 0) {
    throw new Error(
      `Electron main bundles runtime or agent code beyond the bridge client: ${outside.join(", ")}. ` +
        "Run it in the runtime and reach it with a host call (RUNTIME_APP_SERVICE_CALLS), " +
        "or move code both processes need to @stella/node-shared.",
    );
  }
};

const workspaceAliases = {
  "@stella/contracts": path.join(repoRootDir, "packages", "contracts"),
  "@stella/model-catalog": path.join(repoRootDir, "packages", "model-catalog"),
  "@stella/node-shared": path.join(repoRootDir, "packages", "node-shared"),
  "@stella/runtime": path.join(repoRootDir, "packages", "runtime"),
  "@stella/theme": path.join(repoRootDir, "packages", "theme"),
};

const fingerprintFilePath = path.join(
  desktopDir,
  ".dev-electron-bundle-fingerprint.json",
);

const bundleSourceRoots = [
  "packages/contracts",
  "packages/desktop/electron",
  "packages/desktop-ui/src/shared/i18n",
  "packages/node-shared",
  "packages/runtime/host/lifecycle",
];
const bundleSourceExcludedPrefixes = ["packages/home-seed/"];
const bundleConfigFiles = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "packages/contracts/package.json",
  "packages/desktop/package.json",
  "packages/desktop/scripts/dev-electron-build.mjs",
  "packages/desktop/tsconfig.electron.json",
  "packages/desktop/tsconfig.preload.json",
  "packages/desktop/tsconfig.browser-pages.json",
  "packages/node-shared/package.json",
  "packages/runtime/package.json",
  ...desktopEnvFiles("development").map((name) => `packages/desktop-ui/${name}`),
];
const bundleSourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
]);

const toPosix = (value) => value.split(path.sep).join("/");

const isBundleSourceRelPath = (relPosixPath) => {
  if (bundleSourceExcludedPrefixes.some((p) => relPosixPath.startsWith(p))) {
    return false;
  }
  return bundleSourceExtensions.has(path.posix.extname(relPosixPath));
};

const pruneDependencyPackageMetadataPlugin = {
  name: "prune-dependency-package-metadata",
  setup(build) {
    build.onLoad({ filter: /package\.json$/ }, async (args) => {
      if (!args.path.includes(`${path.sep}node_modules${path.sep}`)) {
        return null;
      }
      const parsed = JSON.parse(await fsPromises.readFile(args.path, "utf8"));
      delete parsed.scripts;
      delete parsed.devDependencies;
      return {
        contents: JSON.stringify(parsed),
        loader: "json",
      };
    });
  },
};

const BROWSER_SCRIPT_PREFIX = "browser-script:";

const browserScriptPlugin = {
  name: "browser-script",
  setup(build) {
    build.onResolve({ filter: /^browser-script:/ }, (args) => ({
      path: path.resolve(
        args.resolveDir,
        args.path.slice(BROWSER_SCRIPT_PREFIX.length),
      ),
      namespace: "browser-script",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "browser-script" },
      async (args) => {
        const result = await runEsbuildBuild({
          absWorkingDir: repoRootDir,
          entryPoints: [args.path],
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          target: "es2022",
          charset: "ascii",
          logLevel: "warning",
          tsconfig: path.join("packages", "desktop", "tsconfig.browser-pages.json"),
        });
        return {
          contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
          loader: "js",
        };
      },
    );
  },
};

const fallbackNodePaths = [
  path.join(repoRootDir, "packages", "runtime", "node_modules"),
  path.join(repoRootDir, "node_modules"),
];

const nodeBundleOptions = {
  absWorkingDir: repoRootDir,
  alias: workspaceAliases,
  nodePaths: fallbackNodePaths,
  bundle: true,
  define: {
    "process.env.VITE_TURNSTILE_SITE_KEY": JSON.stringify(
      publicTurnstileSiteKey,
    ),
    // CommonJS code in the bundle reads these as free variables. As defines
    // rather than banner declarations they cannot collide with a module's own
    // top-level `const __dirname`, which esbuild keeps unrenamed in a chunk
    // where nothing else claims the name. Every output sits in one folder, so
    // the folder is the same whichever file a module lands in.
    __dirname: "import.meta.dirname",
    __filename: "import.meta.filename",
  },
  external: [
    "electron",
    ...rendererSourceExternals,
    "bun:*",
    "@silvia-odwyer/photon-node",
    "mac-screen-capture-permissions",
    "uiohook-napi",
  ],
  banner: {
    js: 'import { createRequire as __stellaCreateRequire } from "node:module"; const require = __stellaCreateRequire(import.meta.url);',
  },
  format: "esm",
  metafile: true,
  logLevel: "warning",
  plugins: [pruneDependencyPackageMetadataPlugin, browserScriptPlugin],
  outdir: path.join("packages", "desktop", outdir),
  platform: "node",
  target: nodeTarget,
  tsconfig: path.join("packages", "desktop", "tsconfig.electron.json"),
};

const buildOptions = [
  {
    ...nodeBundleOptions,
    entryPoints: splitMainEntryPoints,
    splitting: true,
    chunkNames: MAIN_CHUNK_NAMES,
  },
  {
    ...nodeBundleOptions,
    entryPoints: electronMainEntryPoints,
  },
  {
    absWorkingDir: repoRootDir,
    alias: workspaceAliases,
    nodePaths: fallbackNodePaths,
    bundle: true,
    external: ["electron"],
    entryPoints: preloadEntryPoints,
    format: "cjs",
    logLevel: "warning",
    plugins: [pruneDependencyPackageMetadataPlugin],
    outdir: path.join("packages", "desktop", outdir),
    platform: "node",
    target: nodeTarget,
    tsconfig: path.join("packages", "desktop", "tsconfig.preload.json"),
  },
];

/**
 * Cold-start boundary for electron-main. esbuild hoists every external
 * `import` statement to the top of the ESM bundle, so a static import of one
 * of these anywhere in the graph — however deep or lazily initialized its
 * importer — is loaded on every launch before `ready`. They are loaded on
 * first use instead (see input/mouse-hook.js).
 */
export const mainStartupDeferredExternals = [
  "uiohook-napi",
  ...rendererSourceExternals,
];
export const mainStartupDeferredInputs = [
  "packages/desktop/electron/source/renderer-source.ts",
  "packages/desktop/electron/source/tools.ts",
];
const mainStartupRootInputs = [
  "packages/desktop/electron/main.ts",
  "packages/desktop/electron/main-process.ts",
  "packages/desktop/electron/bootstrap.ts",
];
const launchEntryInput = "packages/desktop/electron/launch.ts";

const collectStaticallyReachableInputs = (metafile, roots) => {
  const reached = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const input = pending.pop();
    if (reached.has(input)) {
      continue;
    }
    reached.add(input);
    for (const imported of metafile?.inputs?.[input]?.imports ?? []) {
      if (!imported.external && imported.kind !== "dynamic-import") {
        pending.push(toPosix(imported.path));
      }
    }
  }
  return reached;
};

const mainStartupStaticImports = (metafile, mainOutputPath) => {
  const found = [];
  const seen = new Set();
  const rootChunks = Object.entries(metafile?.outputs ?? {})
    .filter(([, output]) => output.entryPoint && mainStartupRootInputs.includes(toPosix(output.entryPoint)))
    .map(([file]) => file);
  const pending = [mainOutputPath, ...rootChunks];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const imported of metafile?.outputs?.[file]?.imports ?? []) {
      if (imported.kind !== "import-statement") continue;
      if (imported.external) {
        found.push([toPosix(path.basename(file)), imported.path]);
      } else {
        pending.push(imported.path);
      }
    }
  }
  return found;
};

export const assertMainBundleStartupBoundary = (metafile) => {
  const violations = [];
  for (const [outputPath, output] of Object.entries(metafile?.outputs ?? {})) {
    const outputPosix = toPosix(outputPath);
    if (outputPosix.endsWith("/electron/launch.js")) {
      const inlined = Object.keys(output.inputs ?? {})
        .map((input) => toPosix(input))
        .filter((input) => input !== launchEntryInput);
      if (inlined.length > 0) {
        violations.push(`electron/launch.js inlines ${inlined.join(", ")}`);
      }
    }
    if (outputPosix.endsWith("/electron/main.js")) {
      for (const [file, imported] of mainStartupStaticImports(metafile, outputPath)) {
        if (mainStartupDeferredExternals.includes(imported)) {
          violations.push(`electron/main.js statically imports ${imported} (in ${file})`);
        }
      }
    }
  }
  const startupInputs = collectStaticallyReachableInputs(
    metafile,
    mainStartupRootInputs,
  );
  for (const input of mainStartupDeferredInputs) {
    if (startupInputs.has(input)) {
      violations.push(`${input} is statically reachable from startup`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Electron main cold-start boundary violated: ${violations.join("; ")}. ` +
        "Load deferred externals on first use (createRequire / dynamic import) " +
        "and keep launch.ts importing the bundle through a computed specifier.",
    );
  }
};

const NON_ASCII = /[^\x00-\x7f]/g;

const asciiOnly = (contents) => {
  const text = Buffer.from(contents.buffer, contents.byteOffset, contents.byteLength).toString("utf8");
  if (!/[^\x00-\x7f]/.test(text)) return contents;
  return Buffer.from(
    text.replace(NON_ASCII, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`),
    "utf8",
  );
};

const writeOutputIfChanged = (absPath, contents) => {
  try {
    const existing = readFileSync(absPath);
    if (existing.length === contents.length && existing.equals(contents)) {
      return false;
    }
  } catch {}
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, contents);
  return true;
};

export const buildElectronBundles = async () => {
  try {
    const results = await Promise.all(
      buildOptions.map((options) =>
        runEsbuildBuild({ ...options, write: false, metafile: true }),
      ),
    );
    const metafile = mergeMetafiles(results.map((result) => result.metafile));
    assertMainBundleRuntimeBoundary(metafile);
    assertMainBundleStartupBoundary(metafile);
    await assertOutputsParse(results);
    const changedOutputs = [];
    const outputs = [];
    for (const result of results) {
      for (const file of result.outputFiles ?? []) {
        outputs.push(toPosix(path.relative(path.join(desktopDir, outdir), file.path)));
        if (writeOutputIfChanged(file.path, asciiOnly(file.contents))) {
          changedOutputs.push(file.path);
        }
      }
    }
    lastBuildInputs = sourceInputsOf(results.map((result) => result.metafile));
    lastBuildOutputs = outputs.sort();
    return changedOutputs;
  } finally {
    await stopEsbuildService();
  }
};

/**
 * The banner's `require` is text esbuild never sees, so a module declaring its
 * own top-level `require` in the same output would only fail when Electron
 * loads that file, possibly long after launch for a chunk. Parse each ESM
 * output here so it fails the build instead.
 */
const assertOutputsParse = async (results) => {
  const failures = [];
  await Promise.all(
    results.flatMap((result) =>
      (result.outputFiles ?? [])
        .filter((file) => file.path.endsWith(".js") && !file.path.includes("preload"))
        .map(async (file) => {
          try {
            await transformWithEsbuild(file.text, { format: "esm", logLevel: "silent" });
          } catch (error) {
            const message = error?.errors?.[0]?.text ?? String(error);
            failures.push(`${path.basename(file.path)}: ${message}`);
          }
        }),
    ),
  );
  if (failures.length > 0) {
    throw new Error(`Electron bundle output does not parse: ${failures.join("; ")}`);
  }
};

const mergeMetafiles = (metafiles) => ({
  inputs: Object.assign({}, ...metafiles.map((metafile) => metafile?.inputs ?? {})),
  outputs: Object.assign({}, ...metafiles.map((metafile) => metafile?.outputs ?? {})),
});

let lastBuildInputs = [];
let lastBuildOutputs = [];
const sourceInputsOf = (metafiles) => {
  const inputs = new Set();
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile?.inputs ?? {})) {
      const posix = toPosix(input);
      if (posix.includes("node_modules/") || posix.startsWith("..") || posix.includes(":")) continue;
      inputs.add(posix);
    }
  }
  return [...inputs].sort();
};

const collectBundleSourceFiles = (inputs = readBundleInputs()) => {
  const files = [];

  const visit = (absolutePath) => {
    let entries;
    try {
      entries = readdirSync(absolutePath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childPath = path.join(absolutePath, entry.name);
      const relPosixPath = toPosix(path.relative(repoRootDir, childPath));
      if (entry.isDirectory()) {
        if (
          !bundleSourceExcludedPrefixes.some((p) =>
            `${relPosixPath}/`.startsWith(p),
          )
        ) {
          visit(childPath);
        }
        continue;
      }
      if (entry.isFile() && isBundleSourceRelPath(relPosixPath)) {
        files.push(relPosixPath);
      }
    }
  };

  for (const root of bundleSourceRoots) {
    visit(path.join(repoRootDir, root));
  }
  for (const configFile of bundleConfigFiles) {
    if (existsSync(path.join(repoRootDir, configFile))) {
      files.push(toPosix(configFile));
    }
  }
  const listed = new Set(files);
  for (const input of inputs) {
    if (!listed.has(input)) files.push(input);
  }

  files.sort();
  return files;
};

export const computeBundleInputsFingerprint = (inputs) => {
  const hash = createHash("sha256");
  for (const relPath of collectBundleSourceFiles(inputs)) {
    let stat;
    try {
      stat = lstatSync(path.join(repoRootDir, relPath));
    } catch {
      continue;
    }
    hash.update(relPath);
    hash.update("\0");
    hash.update(String(stat.size));
    hash.update("\0");
    hash.update(String(stat.mtimeMs));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const readFingerprintFile = (file = fingerprintFilePath) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const readBundleFingerprint = () => {
  const parsed = readFingerprintFile();
  return typeof parsed?.fingerprint === "string" ? parsed.fingerprint : null;
};

export const readBundleInputs = (file = fingerprintFilePath) => {
  const inputs = readFingerprintFile(file)?.inputs;
  return Array.isArray(inputs) ? inputs.filter((input) => typeof input === "string") : [];
};

export const installedPackagesStamp = () => {
  try {
    const names = readdirSync(path.join(repoRootDir, "node_modules", ".bun")).sort();
    return createHash("sha256").update(names.join("\n")).digest("hex");
  } catch {
    return null;
  }
};

export const readBundleOutputs = (file = fingerprintFilePath) => {
  const outputs = readFingerprintFile(file)?.outputs;
  return Array.isArray(outputs) && outputs.every((output) => typeof output === "string")
    ? outputs
    : null;
};

const entryOutputs = () =>
  [...Object.keys(splitMainEntryPoints), ...Object.keys(electronMainEntryPoints), ...Object.keys(preloadEntryPoints)].map(
    (entry) => `${entry}.js`,
  );

const writeBundleFingerprint = (
  fingerprint,
  inputs,
  outputs,
  packages = installedPackagesStamp(),
) => {
  try {
    writeFileSync(
      fingerprintFilePath,
      JSON.stringify(
        { fingerprint, updatedAt: new Date().toISOString(), inputs, outputs, packages },
        null,
        2,
      ),
    );
  } catch {}
};

export const requiredOutputsExist = () => {
  const outBase = path.join(desktopDir, outdir);
  const entries = [
    "launch.js",
    "main.js",
    "preload.js",
    "offscreen-tab-mirror-preload.js",
  ].map((name) => `electron/${name}`);
  return [...entries, ...(readBundleOutputs() ?? [])].every((name) =>
    existsSync(path.join(outBase, name)),
  );
};

export const pruneStaleMainChunks = () => {
  const outputs = readBundleOutputs();
  if (!outputs) return 0;
  const current = new Set(outputs);
  const dir = path.join(desktopDir, outdir, "electron");
  let removed = 0;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!MAIN_CHUNK_FILE.test(name) || current.has(`electron/${name}`)) continue;
    try {
      rmSync(path.join(dir, name), { force: true });
      removed += 1;
    } catch {}
  }
  return removed;
};

export const cleanOutdir = async () => {
  await fsPromises.rm(path.join(desktopDir, outdir, "electron"), {
    force: true,
    recursive: true,
  });
};

export const ensureElectronBundlesFresh = async ({ log } = {}) => {
  const fingerprint = computeBundleInputsFingerprint();
  if (requiredOutputsExist() && readBundleFingerprint() === fingerprint) {
    return { built: false };
  }
  if (!requiredOutputsExist()) {
    await cleanOutdir();
  }
  const startedAt = Date.now();
  await buildElectronBundles();
  writeBundleFingerprint(
    computeBundleInputsFingerprint(lastBuildInputs),
    lastBuildInputs,
    lastBuildOutputs,
  );
  log?.(`built main and preload in ${Date.now() - startedAt}ms`);
  return { built: true };
};

export const adoptElectronBundles = (from) => {
  const fromOut = path.join(from, outdir);
  const fromFingerprint = path.join(from, path.basename(fingerprintFilePath));
  const inputs = readBundleInputs(fromFingerprint);
  const outputs = readBundleOutputs(fromFingerprint) ?? entryOutputs();
  if (inputs.length === 0 || !outputs.every((name) => existsSync(path.join(fromOut, name)))) {
    return { adopted: false };
  }
  const packages = installedPackagesStamp();
  const builtAgainst = readFingerprintFile(path.join(from, path.basename(fingerprintFilePath)))?.packages;
  if (!packages || builtAgainst !== packages) {
    return { adopted: false };
  }
  for (const name of outputs) {
    writeOutputIfChanged(path.join(desktopDir, outdir, name), readFileSync(path.join(fromOut, name)));
  }
  writeBundleFingerprint(computeBundleInputsFingerprint(inputs), inputs, outputs);
  return { adopted: true };
};

if (isEntryPoint(import.meta.url)) {
  try {
    await cleanOutdir();
    await buildElectronBundles();
    writeBundleFingerprint(
      computeBundleInputsFingerprint(lastBuildInputs),
      lastBuildInputs,
      lastBuildOutputs,
    );
    process.exit(0);
  } catch (error) {
    console.error(
      `[electron-build] Build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
