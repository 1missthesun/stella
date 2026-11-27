// The Bun runtime plugin that lets master's Electron main run unchanged in the host: `electron`
// (and electron/main, electron/common) and `uiohook-napi` resolve to the shim, `browser-script:` imports become the
// bundled page script text, as esbuild's browser-script plugin builds them for Electron.

import { plugin, type BunPlugin } from "bun";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { electronModule } from "./index";
import * as uiohook from "./uiohook";
import { atAppRoot, fromRoot, relocateModulePaths, MODULE_PATHS } from "../../../../scripts/lib/module-paths.mjs";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const ELECTRON_DIR = path.join(REPO_ROOT, "packages/desktop/electron");
const BROWSER_SCRIPT = /["']browser-script:([^"']+)["']/g;
/** Electron main runs from an esbuild bundle in this folder; its path math assumes it. */
const BUNDLE_DIR = path.join(REPO_ROOT, "packages/desktop/dist-electron/electron");
/**
 * Electron main exports Rune replaces: Chromium-only machinery with a Rune counterpart. The
 * original stays exported as `__electron_<name>` for a replacement that wraps it.
 */
const OVERRIDES: Array<{ file: string; name: string; from: string }> = [
  { file: "source/renderer-protocol.ts", name: "serveRendererSource", from: path.resolve(import.meta.dir, "../services/renderer-source.ts") },
  { file: "services/in-app-browser/offscreen-tabs.ts", name: "OffscreenTabs", from: path.resolve(import.meta.dir, "../services/offscreen-tabs.ts") },
  { file: "bootstrap/context.js", name: "createBootstrapContext", from: path.resolve(import.meta.dir, "../services/main-context.ts") },
  { file: "services/app-source/update-transition.ts", name: "UpdateTransition", from: path.resolve(import.meta.dir, "../services/update-transition.ts") },
  { file: "services/offscreen-media-probe.ts", name: "offscreenVideoPoster", from: path.resolve(import.meta.dir, "../services/media-probe.ts") },
  { file: "services/offscreen-media-probe.ts", name: "offscreenMediaDurationMs", from: path.resolve(import.meta.dir, "../services/media-probe.ts") },
  { file: "services/microphone-capture.ts", name: "MicrophoneCapture", from: path.resolve(import.meta.dir, "../services/microphone-capture.ts") },
  { file: "services/app-source/draft-preview.ts", name: "openDraftPreview", from: path.resolve(import.meta.dir, "../services/draft-preview.ts") },
];

const applyOverrides = (file: string, source: string) => {
  for (const o of OVERRIDES) {
    if (path.join(ELECTRON_DIR, o.file) !== path.normalize(file)) continue;
    const declaration = new RegExp(`export (const|let|class|function|async function) ${o.name}\\b`);
    if (!declaration.test(source)) throw new Error(`Rune override: ${o.file} no longer exports ${o.name}`);
    source = source.replace(declaration, (_m, kind: string) => `export ${kind} __electron_${o.name}`);
    source += `\nexport { ${o.name} } from ${JSON.stringify(o.from)};\n`;
  }
  return source;
};

const ELECTRON_SOURCE = new RegExp(`^${ELECTRON_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\\\/](?!.*\\.page\\.ts$).*\\.(ts|js)$`);

/** Master's sources see the dirname of the bundle Electron runs (BUNDLE_DIR). */
const adaptElectronSource = (file: string, source: string, bundleDir = JSON.stringify(BUNDLE_DIR)) => {
  source = applyOverrides(file, source).replaceAll("import.meta.dirname", bundleDir);
  if (/\b__dirname\b/.test(source) && !/\b(?:const|let|var)\s+__dirname\b/.test(source)) {
    source = `const __dirname = ${bundleDir};\n${source}`;
  }
  return source;
};

/**
 * In the host bundle a path is an expression on the app folder the bundle runs from
 * (`globalThis.__stellaAppPath`, set by host/main.tsx), not the folder it was built in: a first
 * install's app bundle carries a host bundle built elsewhere (scripts/build-app-bundle.mjs).
 */
const AT_APP = atAppRoot(REPO_ROOT);

const browserScriptImports = (): Array<{ specifier: string; file: string }> => {
  const found: Array<{ specifier: string; file: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(full); continue; }
      if (!/\.(ts|js|mjs)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      if (!source.includes("browser-script:")) continue;
      for (const m of source.matchAll(BROWSER_SCRIPT)) {
        found.push({ specifier: `browser-script:${m[1]}`, file: path.resolve(dir, m[1]!) });
      }
    }
  };
  walk(ELECTRON_DIR);
  return found;
};

let installed = false;

export function installElectronPlugin() {
  if (installed) return;
  installed = true;
  const exports = { ...electronModule, default: electronModule };
  plugin({
    name: "stella-rune-electron",
    setup(build) {
      for (const name of ["electron", "electron/main", "electron/common"]) {
        build.module(name, () => ({ exports, loader: "object" }));
      }
      build.module("uiohook-napi", () => ({ exports: { ...uiohook, default: uiohook }, loader: "object" }));
      build.onLoad({ filter: ELECTRON_SOURCE }, (args) => {
        return { contents: adaptElectronSource(args.path, readFileSync(args.path, "utf8")), loader: args.path.endsWith(".js") ? "js" : "ts" };
      });
      const seen = new Map<string, string>();
      for (const { specifier, file } of browserScriptImports()) {
        const other = seen.get(specifier);
        if (other && other !== file) throw new Error(`browser-script specifier ${specifier} names two files (${other}, ${file})`);
        seen.set(specifier, file);
        build.module(specifier, async () => {
          const result = await Bun.build({
            entrypoints: [file],
            format: "iife",
            target: "browser",
            tsconfig: path.join(REPO_ROOT, "packages/desktop/tsconfig.browser-pages.json"),
          } as Parameters<typeof Bun.build>[0]);
          if (!result.success) throw new Error(result.logs.map(String).join("\n"));
          return { contents: `export default ${JSON.stringify(await result.outputs[0]!.text())};`, loader: "js" };
        });
      }
    },
  });
}

const browserPageText = async (file: string, inputs: Set<string>) => {
  const result = await Bun.build({
    entrypoints: [file],
    format: "iife",
    target: "browser",
    tsconfig: path.join(REPO_ROOT, "packages/desktop/tsconfig.browser-pages.json"),
    metafile: true,
  } as Parameters<typeof Bun.build>[0]);
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  for (const input of Object.keys((result as { metafile?: { inputs: Record<string, unknown> } }).metafile?.inputs ?? {})) {
    if (!input.includes(":")) inputs.add(path.resolve(input));
  }
  return result.outputs[0]!.text();
};

/** React is one instance for the host's reconciler and the UI bundle, which requires it too. */
const SHARED_WITH_UI = /^(react|react-dom|react-reconciler|scheduler)(\/|$)/;
const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx" };

/**
 * The host as one Bun bundle (services/host-bundle-build.ts) does what the runtime plugin above
 * does, at build time: `electron` and `uiohook-napi` are the shim's own modules, `browser-script:`
 * pages are inlined (their sources collected in `pageInputs`) and master's sources are adapted. Packages are inlined by their real path
 * (one copy each), except native addons and React, which stay external; `externals` collects
 * those. Every inlined file keeps its own `import.meta` and `__dirname`, and no `import.meta`
 * is left, since CJS bytecode refuses it.
 */
export async function hostBundlePlugin(externals: Set<string>, pageInputs: Set<string>): Promise<BunPlugin> {
  const shimKeys = Object.keys(electronModule);
  const pages = new Map<string, string>();
  for (const { file } of browserScriptImports()) {
    if (!file.includes("*") && !pages.has(file)) pages.set(file, await browserPageText(file, pageInputs));
  }
  const shim = (file: string) => JSON.stringify(path.resolve(import.meta.dir, file));
  return {
    name: "stella-rune-host-bundle",
    setup(build) {
      build.onResolve({ filter: /^(electron(\/main|\/common)?|uiohook-napi)$/ }, (args) => ({ path: args.path === "uiohook-napi" ? "uiohook" : "electron", namespace: "rune-shim" }));
      build.onLoad({ filter: /.*/, namespace: "rune-shim" }, (args) => ({
        contents: args.path === "electron"
          ? `import { electronModule as m } from ${shim("index.ts")};\nexport const { ${shimKeys.join(", ")} } = m;\nexport default m;\n`
          : `export * from ${shim("uiohook.ts")};\nimport * as u from ${shim("uiohook.ts")};\nexport default u;\n`,
        loader: "js",
      }));
      build.onResolve({ filter: /^browser-script:/ }, (args) => ({ path: path.resolve(path.dirname(args.importer), args.path.slice("browser-script:".length)), namespace: "browser-script" }));
      build.onLoad({ filter: /.*/, namespace: "browser-script" }, (args) => {
        const text = pages.get(args.path);
        if (text === undefined) throw new Error(`browser-script page ${args.path} was not prebuilt`);
        return { contents: `export default ${JSON.stringify(text)};`, loader: "js" };
      });
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        if (/^(bun|node):/.test(args.path) || !args.importer) return undefined;
        let resolved: string;
        try { resolved = Bun.resolveSync(args.path, path.dirname(args.importer)); } catch { return undefined; }
        if (!path.isAbsolute(resolved)) return undefined;
        const real = realpathSync(resolved);
        if (!/[\\/]node_modules[\\/]/.test(real)) return undefined;
        if (!/\.node$/.test(real) && !SHARED_WITH_UI.test(args.path)) return { path: real };
        externals.add(real);
        // By name: it resolves from the bundle's folder to the app's node_modules, wherever that is.
        return { path: args.path, external: true };
      });
      build.onLoad({ filter: /\.([cm]?[jt]sx?)$/ }, (args) => {
        const file = args.path;
        const electron = ELECTRON_SOURCE.test(file);
        let source = readFileSync(file, "utf8");
        if (!electron && !MODULE_PATHS.test(source)) return undefined;
        if (electron) source = adaptElectronSource(file, source, AT_APP.path(fromRoot(REPO_ROOT, BUNDLE_DIR))).replace(/^await import\((["'][^"']+["'])\);$/gm, "import $1;");
        source = relocateModulePaths(source, file, REPO_ROOT, AT_APP, { wrapImportMeta: true });
        return { contents: source, loader: LOADERS[path.extname(file)] ?? "js" };
      });
    },
  };
}
