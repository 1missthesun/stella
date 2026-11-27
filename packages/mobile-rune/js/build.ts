// The phone's JS bundle: one classic script (app.js) the iOS app evaluates in JavaScriptCore.
// It holds the desktop host's bridge and React reconciler (packages/desktop-rune/host), the
// DOM stand-ins desktop-ui's logic needs (host/dom), the web polyfills (js/polyfills.ts) and
// the app: the phone shell (packages/mobile-rune/ui) over the Rune UI kit, chat and theme
// (packages/desktop-rune/ui) and desktop-ui's stores, in its web build (cloud execution).
//   bun packages/mobile-rune/js/build.ts [--out DIR] [--no-minify] [--backend dev|prod|URL]

import type { BunPlugin } from "bun";
import fs from "node:fs";
import path from "node:path";
import { webBuildEnv } from "../../desktop/electron/source/build-web";
import { replacementFor, resolveSpecifier, viteCompat } from "../../desktop-rune/host/vite-compat";

const MOBILE = path.resolve(import.meta.dir, "..");
const REPO = path.resolve(MOBILE, "../..");
const RUNE = path.join(REPO, "packages", "desktop-rune");
const UI_ROOT = path.join(REPO, "packages", "desktop-ui");
const JS = path.join(MOBILE, "js");
const REPLACE = path.join(JS, "replace");
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp3|wav|ogg|m4a|mp4|webm|mov|wasm|pdf|txt|md|html)$/i;

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outDir = path.resolve(flag("--out") ?? path.join(MOBILE, "build", "js"));
const minify = !process.argv.includes("--no-minify");

// `--backend dev|prod|<url>`: the backend the app talks to (its Apps hosts are paired with it).
const BACKENDS: Record<string, string> = {
  dev: "https://stella-v2-cloud-builder-dev.fromyou.workers.dev",
  prod: "https://stella-v2-cloud-builder-prod.fromyou.workers.dev",
};
const backend = flag("--backend");
if (backend) process.env.VITE_STELLA_BACKEND_URL = BACKENDS[backend] ?? backend;
const env = webBuildEnv(UI_ROOT);
for (const [k, v] of Object.entries(env)) if (k.startsWith("VITE_") && typeof v === "string") process.env[k] = v;
process.env.VITE_STELLA_WEB_BUILD = "1";
process.env.VITE_STELLA_MOBILE_RUNE = "1";
process.env.STELLA_UI_BASE_URL = "./";

// The Expo project the backend sends push through (the RN app's), for the phone's Expo push token.
const easProjectId = process.env.STELLA_MOBILE_EAS_PROJECT_ID ?? (JSON.parse(fs.readFileSync(path.join(REPO, "packages", "mobile", "app.json"), "utf8")) as { expo?: { extra?: { eas?: { projectId?: string } } } }).expo?.extra?.eas?.projectId ?? "";

const resolveFrom = (spec: string, dir: string) => Bun.resolveSync(spec, dir);
const WEB_SHIMS = path.join(RUNE, "web", "shims");
const SHIMS: Record<string, string> = {
  fs: path.join(JS, "shims", "node-fs.ts"),
  "fs/promises": path.join(JS, "shims", "node-fs.ts"),
  crypto: path.join(JS, "shims", "node-crypto.ts"),
  child_process: path.join(WEB_SHIMS, "node-misc.ts"),
  os: path.join(WEB_SHIMS, "node-misc.ts"),
  url: path.join(WEB_SHIMS, "node-misc.ts"),
  path: path.join(WEB_SHIMS, "node-path.ts"),
  events: path.join(JS, "shims", "node-events.ts"),
  buffer: path.join(JS, "shims", "node-buffer.ts"),
  util: path.join(JS, "shims", "node-util.ts"),
};

/** `js/replace/<path>` stands in for `packages/desktop-rune/<path>` on the phone. */
function replacementOf(file: string): string | undefined {
  if (!file.startsWith(RUNE + path.sep)) return undefined;
  const rel = path.relative(RUNE, file).replace(/\.(m?[jt]sx?)$/, "");
  for (const ext of [".ts", ".tsx", ".js"]) {
    const candidate = path.join(REPLACE, rel + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveRelative(spec: string, importer: string): string | undefined {
  const base = path.resolve(path.dirname(importer), spec);
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  for (const ext of [".ts", ".tsx", ".js"]) if (fs.existsSync(path.join(base, "index" + ext))) return path.join(base, "index" + ext);
  return undefined;
}

const DESKTOP_UI_SRC = path.join(UI_ROOT, "src");

// Bun's bundler drops namespace bindings (`import * as ns`, `export * as ns`, e.g. zod's `util`,
// the kit's `Icons`) whenever any plugin has an onResolve hook on relative paths, even one that
// returns nothing. Modules with a relative namespace import get every relative specifier made
// absolute before those hooks see it (with the phone's replacements applied).
const NAMESPACE_FROM_RELATIVE = /(?:import|export)\s*\*\s*as\s+[\w$]+\s+from\s*["']\.\.?\//;
const namespaceFix: BunPlugin = {
  name: "stella-rune-namespace-fix",
  setup(build) {
    build.onLoad({ filter: /\.(m?js|jsx|tsx?)$/ }, async (a) => {
      const text = await Bun.file(a.path).text();
      if (!NAMESPACE_FROM_RELATIVE.test(text)) return undefined;
      const local = !a.path.includes(`${path.sep}node_modules${path.sep}`);
      if (local && (text.includes("import.meta.glob") || text.includes("import.meta.env"))) throw new Error(`namespace fix: ${a.path} also needs vite-compat`);
      const contents = text.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\.?\/[^"']+)\2/g, (_m, pre: string, q: string, spec: string) => {
        let target = path.resolve(path.dirname(a.path), spec);
        if (local) {
          const file = resolveRelative(spec, a.path);
          if (file) target = replacementOf(file) ?? file;
        }
        return `${pre}${q}${target}${q}`;
      });
      const ext = a.path.match(/\.(m?js|jsx|tsx?)$/)![1];
      return { contents, loader: (ext === "mjs" ? "js" : ext) as "js" | "jsx" | "ts" | "tsx" };
    });
  },
};
const mobilePlugin: BunPlugin = {
  name: "stella-rune-mobile",
  setup(build) {
    build.onResolve({ filter: /^(@\/|\.\.?\/)/ }, (a) => {
      if (!a.path.startsWith("@/") && !a.importer.startsWith(DESKTOP_UI_SRC + path.sep)) return undefined;
      const file = resolveSpecifier(a.path, a.importer);
      const replacement = file && replacementFor(file, a.importer);
      // desktop-rune's own stand-ins (ui/replace/…) can have a phone one in turn.
      return replacement ? { path: replacementOf(replacement) ?? replacement } : undefined;
    });
    // Rune elements are the engine's own host elements: `rune-jsx` is React's JSX runtime, as the desktop host's tsconfig.build.json makes it.
    build.onResolve({ filter: /^rune-jsx\/jsx-(dev-)?runtime$/ }, (a) => ({ path: resolveFrom(a.path.replace(/^rune-jsx/, "react"), UI_ROOT) }));
    // One React for everything (desktop-ui's), and the reconciler next to it.
    build.onResolve({ filter: /^(react|react-dom|react-reconciler)(\/.*)?$/ }, (a) => ({ path: resolveFrom(a.path, a.path.startsWith("react-reconciler") ? RUNE : UI_ROOT) }));
    // The phone's own files use the desktop's workspace packages (`@stella/views`, `@stella/contracts`), linked under desktop-rune.
    build.onResolve({ filter: /^@stella\// }, (a) => (a.importer.startsWith(MOBILE + path.sep) ? { path: resolveFrom(a.path, RUNE) } : undefined));
    build.onResolve({ filter: /^bun:/ }, () => ({ path: path.join(JS, "shims", "bun-ffi.ts") }));
    build.onResolve({ filter: /^(node:)?(fs|fs\/promises|crypto|child_process|os|url|path|events|buffer|util)$/ }, (a) => {
      if (a.importer.includes(`${path.sep}node_modules${path.sep}`) && !a.path.startsWith("node:")) return undefined;
      return { path: SHIMS[a.path.replace(/^node:/, "")]! };
    });
    build.onResolve({ filter: /^node:/ }, () => ({ path: path.join(JS, "shims", "node-empty.ts") }));
    build.onResolve({ filter: /^\.\.?\// }, (a) => {
      if (!a.importer.startsWith(RUNE + path.sep)) return undefined;
      const file = resolveRelative(a.path, a.importer);
      const replacement = file && replacementOf(file);
      return replacement ? { path: replacement } : undefined;
    });
    // Assets ship in the app bundle: an import is its path there.
    build.onLoad({ filter: ASSET }, async (a) => {
      if (a.path.includes(`${path.sep}node_modules${path.sep}`) && !/\.(png|jpe?g|gif|webp|svg|ttf|otf)$/i.test(a.path)) return undefined;
      const name = path.basename(a.path);
      if (/\.(ttf|otf)$/i.test(name)) return { contents: `export default __native.env.resources + "/fonts/" + ${JSON.stringify(name)};`, loader: "js" };
      const rel = `assets/${Bun.hash(a.path).toString(16)}-${name}`;
      fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
      fs.copyFileSync(a.path, path.join(outDir, rel));
      return { contents: `export default __native.env.resources + "/" + ${JSON.stringify(rel)};`, loader: "js" };
    });
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
};

const startedAt = Date.now();
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const result = await Bun.build({
  entrypoints: [path.join(JS, "entry.ts")],
  outdir: outDir,
  target: "browser",
  format: "iife",
  splitting: false,
  minify: minify ? { whitespace: true, syntax: true, identifiers: false } : false,
  sourcemap: "none",
  naming: { entry: "app.[ext]" },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env.STELLA_EAS_PROJECT_ID": JSON.stringify(easProjectId), "import.meta.hot": "undefined", "import.meta.dir": "__native.env.resources", "import.meta.dirname": "__native.env.resources", "import.meta.url": JSON.stringify("file:///app/app.js") },
  plugins: [namespaceFix, mobilePlugin, viteCompat],
  throw: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  throw new Error("The phone bundle failed.");
}
const entry = result.outputs.find((o) => o.kind === "entry-point")!;
console.log(`app.js ${(fs.statSync(entry.path).size / 1024).toFixed(0)} KB in ${Date.now() - startedAt} ms → ${outDir}`);
