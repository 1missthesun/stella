// What every web bundle of the Rune UI shares: the resolver plugin that puts the UI on the DOM host
// (web/dom), with desktop-ui's modules and web shims, the Stella Views worker bundle, and Stella's
// fonts as files. web/build.ts builds the chat app with it; web/share/build.ts the shared-view page.

import type { BunPlugin } from "bun";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { replacementFor, resolveSpecifier, viteCompat } from "../host/vite-compat";

export { viteCompat };

export const RUNE = path.resolve(import.meta.dir, "..");
export const REPO = path.resolve(RUNE, "../..");
export const UI_ROOT = path.join(REPO, "packages", "desktop-ui");
export const WEB = path.join(RUNE, "web");
const REPLACE = path.join(WEB, "replace");
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp3|wav|ogg|m4a|mp4|webm|mov|wasm|pdf|txt|md|html)$/i;

const resolveFrom = (spec: string, dir: string) => Bun.resolveSync(spec, dir);
const SHIMS: Record<string, string> = {
  fs: "node-fs.ts", "fs/promises": "node-fs.ts", child_process: "node-misc.ts", os: "node-misc.ts", url: "node-misc.ts", path: "node-path.ts",
};

function replacementOf(file: string): string | undefined {
  if (!file.startsWith(RUNE + path.sep) || file.startsWith(WEB + path.sep)) return undefined;
  const candidate = path.join(REPLACE, path.relative(RUNE, file));
  return fs.existsSync(candidate) ? candidate : undefined;
}

function resolveRelative(spec: string, importer: string): string | undefined {
  const base = path.resolve(path.dirname(importer), spec);
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  return undefined;
}

const DESKTOP_UI_SRC = path.join(UI_ROOT, "src");
const REEXPORT = /^export \* from "([^"]+)";?\s*$/;

/** A replacement that only re-exports another module, as that module, so the two never split into identical chunks. */
function throughReexport(file: string): string {
  const only = REEXPORT.exec(fs.readFileSync(file, "utf8"));
  const target = only && resolveRelative(only[1]!, file);
  return target ? (replacementOf(target) ?? target) : file;
}

export const webPlugin: BunPlugin = {
  name: "stella-rune-web",
  setup(build) {
    build.onResolve({ filter: /^(@\/|\.\.?\/)/ }, (a) => {
      if (!a.path.startsWith("@/") && !a.importer.startsWith(DESKTOP_UI_SRC + path.sep)) return undefined;
      const file = resolveSpecifier(a.path, a.importer);
      const replacement = file && replacementFor(file, a.importer);
      return replacement ? { path: throughReexport(replacement) } : undefined;
    });
    const runeSource = (importer: string) => importer.startsWith(path.join(RUNE, "ui") + path.sep) || importer.startsWith(REPLACE + path.sep);
    build.onResolve({ filter: /^(rune-jsx|react)\/jsx-(dev-)?runtime$/ }, (a) =>
      a.path.startsWith("rune-jsx") || runeSource(a.importer) ? { path: path.join(WEB, "jsx-runtime.ts") } : undefined,
    );
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (a) => {
      return { path: a.path === "react" && runeSource(a.importer) ? path.join(WEB, "react-proxy.js") : resolveFrom(a.path, UI_ROOT) };
    });
    build.onResolve({ filter: /^(node:)?(fs|fs\/promises|child_process|os|url|path)$/ }, (a) => {
      if (a.importer.includes(`${path.sep}node_modules${path.sep}`) && !a.path.startsWith("node:")) return undefined;
      return { path: path.join(WEB, "shims", SHIMS[a.path.replace(/^node:/, "")]!) };
    });
    build.onResolve({ filter: /^\.\.?\// }, (a) => {
      if (!a.importer.startsWith(RUNE + path.sep)) return undefined;
      const file = resolveRelative(a.path, a.importer);
      const replacement = file && replacementOf(file);
      return replacement ? { path: replacement } : undefined;
    });
    build.onLoad({ filter: ASSET }, async (a) => {
      if (a.path.includes(`${path.sep}node_modules${path.sep}`) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(a.path)) return undefined;
      return { contents: await Bun.file(a.path).bytes(), loader: "file" };
    });
  },
};

/** A Stella View's worker (web/views/view-worker.ts), its own bundle in `dir`; returns its file name. */
export async function buildViewWorker(dir: string, minify: boolean): Promise<string> {
  const viewWorker = await Bun.build({
    entrypoints: [path.join(WEB, "views", "view-worker.ts")],
    outdir: dir,
    target: "browser",
    format: "esm",
    minify,
    sourcemap: "none",
    naming: "[name]-[hash].[ext]",
    throw: false,
  });
  const viewWorkerFile = viewWorker.outputs.find((o) => o.kind === "entry-point");
  if (!viewWorker.success || !viewWorkerFile) {
    for (const log of viewWorker.logs) console.error(String(log));
    throw new Error("The views worker build failed.");
  }
  return path.basename(viewWorkerFile.path);
}

/**
 * Stella's fonts: the stylesheet and its font files in `outDir/<assets>`, each font a file (Bun
 * inlines small ones as data URLs; a page preloads them as files). Returns the stylesheet's path
 * relative to `outDir` and `emitFile`, which copies another file beside them under a hashed name.
 */
export async function buildFonts(outDir: string, assets: string): Promise<{ css: string; emitFile: (file: string) => string }> {
  const fonts = await Bun.build({
    entrypoints: [path.join(UI_ROOT, "src", "shared", "styles", "fonts.css")],
    outdir: outDir,
    target: "browser",
    minify: true,
    publicPath: "./",
    naming: { entry: `${assets}/[name]-[hash].[ext]`, asset: `${assets}/[name]-[hash].[ext]` },
    throw: false,
  });
  if (!fonts.success) {
    for (const log of fonts.logs) console.error(String(log));
    throw new Error("The font stylesheet build failed.");
  }
  const rel = (file: string) => path.relative(outDir, file).split(path.sep).join("/");
  const fontCss = fonts.outputs.find((o) => o.path.endsWith(".css"));
  if (!fontCss) throw new Error("The font build produced no stylesheet.");
  const fontOutputs = fonts.outputs.filter((o) => o.kind === "asset");
  const emitFile = (file: string) => {
    const ext = path.extname(file);
    const built = fontOutputs.find((o) => path.basename(o.path).startsWith(`${path.basename(file, ext)}-`) && o.path.endsWith(ext));
    if (built) return rel(built.path);
    const bytes = fs.readFileSync(file);
    const hash = createHash("sha256").update(bytes).digest("base64url").slice(0, 8);
    const name = `${assets}/${path.basename(file, ext)}-${hash}${ext}`;
    fs.writeFileSync(path.join(outDir, name), bytes);
    return name;
  };
  const fontSource = path.join(UI_ROOT, "src", "shared", "styles", "fonts.css");
  const fontFiles = [...fs.readFileSync(fontSource, "utf8").matchAll(/url\(\s*"?([^")]+)"?\s*\)/g)].map((m) => path.resolve(path.dirname(fontSource), m[1]!));
  const fileForDataUrl = (url: string) => {
    const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const file = fontFiles.find((f) => fs.existsSync(f) && fs.statSync(f).size === bytes.length && fs.readFileSync(f).equals(bytes));
    return file ? `./${path.basename(emitFile(file))}` : url;
  };
  const fontCssText = fs
    .readFileSync(fontCss.path, "utf8")
    .replace(/url\(\s*("?)(data:font\/[^")]+)\1\s*\)/g, (_m, _q, url: string) => `url(${fileForDataUrl(url)})`)
    .replace(new RegExp(`url\\("?\\./${assets}/`, "g"), (m) => m.replace(`./${assets}/`, "./"));
  fs.rmSync(fontCss.path);
  const css = `${assets}/fonts-${createHash("sha256").update(fontCssText).digest("base64url").slice(0, 8)}.css`;
  fs.writeFileSync(path.join(outDir, css), fontCssText);
  return { css, emitFile };
}
