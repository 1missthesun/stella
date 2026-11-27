// The web build of ui/ (stella.sh/chat's /chat-app): the Rune UI on the DOM host (web/dom), with
// desktop-ui's web page around it (index.html, public/, fonts, canvas host) and its web env.
// bun packages/desktop-rune/web/build.ts [--out <dir>] [--script-src <source>]... [--no-minify] [--no-static-home]

import type { BunPlugin } from "bun";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CANVAS_HOST_FILE, CANVAS_HOST_HTML } from "@stella/contracts/canvas-host";
import { webBuildEnv } from "../../desktop/electron/source/build-web";
import { getThemeById, resolveThemeColors } from "@stella/theme";
import { replacementFor, resolveSpecifier, viteCompat } from "../host/vite-compat";
import { Icons, withStroke } from "../ui/kit/icons";
import { buildTokens } from "../ui/theme/tokens";
import { STATIC_HOME_LOOK_KEY, staticHomeLook, type StaticHomeLook } from "./static-home/palette";

const RUNE = path.resolve(import.meta.dir, "..");
const REPO = path.resolve(RUNE, "../..");
const UI_ROOT = path.join(REPO, "packages", "desktop-ui");
const WEB = path.join(RUNE, "web");
const REPLACE = path.join(WEB, "replace");
const ASSETS = "assets";
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|mp3|wav|ogg|m4a|mp4|webm|mov|wasm|pdf|txt|md|html)$/i;
const LAUNCH_RESCUE = /    <div id="stella-launch"[\s\S]*?<script src="[^"\n]*\/stella-launch-rescue\.js"><\/script>\s*/;

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outDir = path.resolve(flag("--out") ?? path.join(REPO, "packages", "website", "public", "chat-app"));
const scriptSources = process.argv.flatMap((arg, i) => (arg === "--script-src" && process.argv[i + 1] ? [process.argv[i + 1]!] : []));

const env = webBuildEnv(UI_ROOT);
for (const [k, v] of Object.entries(env)) if (k.startsWith("VITE_") && typeof v === "string") process.env[k] = v;
process.env.STELLA_LAUNCHER = "1";
process.env.STELLA_UI_BASE_URL = "./";

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

const webPlugin: BunPlugin = {
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

const startedAt = Date.now();
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, ASSETS), { recursive: true });

// A Stella View's worker (web/views/view-worker.ts) is its own bundle beside the app's chunks; the app
// finds it by the name defined below.
const viewWorker = await Bun.build({
  entrypoints: [path.join(WEB, "views", "view-worker.ts")],
  outdir: path.join(outDir, ASSETS),
  target: "browser",
  format: "esm",
  minify: !process.argv.includes("--no-minify"),
  sourcemap: "none",
  naming: "[name]-[hash].[ext]",
  throw: false,
});
const viewWorkerFile = viewWorker.outputs.find((o) => o.kind === "entry-point");
if (!viewWorker.success || !viewWorkerFile) {
  for (const log of viewWorker.logs) console.error(String(log));
  throw new Error("The views worker build failed.");
}

const app = await Bun.build({
  entrypoints: [path.join(WEB, "entry.ts")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: !process.argv.includes("--no-minify"),
  sourcemap: "none",
  naming: { entry: `${ASSETS}/[name]-[hash].[ext]`, chunk: `${ASSETS}/[name]-[hash].[ext]`, asset: `${ASSETS}/[name]-[hash].[ext]` },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.hot": "undefined", __STELLA_VIEW_WORKER__: JSON.stringify(path.basename(viewWorkerFile.path)) },
  plugins: [webPlugin, viteCompat],
  throw: false,
});
if (!app.success) {
  for (const log of app.logs) console.error(String(log));
  throw new Error("The Rune web build failed.");
}

const fonts = await Bun.build({
  entrypoints: [path.join(UI_ROOT, "src", "shared", "styles", "fonts.css")],
  outdir: outDir,
  target: "browser",
  minify: true,
  publicPath: "./",
  naming: { entry: `${ASSETS}/[name]-[hash].[ext]`, asset: `${ASSETS}/[name]-[hash].[ext]` },
  throw: false,
});
if (!fonts.success) {
  for (const log of fonts.logs) console.error(String(log));
  throw new Error("The font stylesheet build failed.");
}

const rel = (file: string) => path.relative(outDir, file).split(path.sep).join("/");
const entry = app.outputs.find((o) => o.kind === "entry-point");
const fontCss = fonts.outputs.find((o) => o.path.endsWith(".css"));
if (!entry || !fontCss) throw new Error("The build produced no entry.");

const fontOutputs = fonts.outputs.filter((o) => o.kind === "asset");
const emitFile = (file: string) => {
  const ext = path.extname(file);
  const built = fontOutputs.find((o) => path.basename(o.path).startsWith(`${path.basename(file, ext)}-`) && o.path.endsWith(ext));
  if (built) return rel(built.path);
  const bytes = fs.readFileSync(file);
  const hash = createHash("sha256").update(bytes).digest("base64url").slice(0, 8);
  const name = `${ASSETS}/${path.basename(file, ext)}-${hash}${ext}`;
  fs.writeFileSync(path.join(outDir, name), bytes);
  return name;
};

const fontSource = path.join(UI_ROOT, "src", "shared", "styles", "fonts.css");
const fontFiles = [...fs.readFileSync(fontSource, "utf8").matchAll(/url\(\s*"?([^")]+)"?\s*\)/g)].map((m) => path.resolve(path.dirname(fontSource), m[1]!));
/** Bun inlines small fonts as data URLs; the page preloads them as files, so the stylesheet points at those files instead. */
const fileForDataUrl = (url: string) => {
  const bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const file = fontFiles.find((f) => fs.existsSync(f) && fs.statSync(f).size === bytes.length && fs.readFileSync(f).equals(bytes));
  return file ? `./${path.basename(emitFile(file))}` : url;
};
const fontCssText = fs
  .readFileSync(fontCss.path, "utf8")
  .replace(/url\(\s*("?)(data:font\/[^")]+)\1\s*\)/g, (_m, _q, url: string) => `url(${fileForDataUrl(url)})`)
  .replace(/url\("?\.\/assets\//g, (m) => m.replace("./assets/", "./"));
fs.rmSync(fontCss.path);
const fontCssFile = `${ASSETS}/fonts-${createHash("sha256").update(fontCssText).digest("base64url").slice(0, 8)}.css`;
fs.writeFileSync(path.join(outDir, fontCssFile), fontCssText);

const originOf = (value: unknown) => {
  try {
    return typeof value === "string" && value.trim() ? new URL(value.trim()).origin : null;
  } catch {
    return null;
  }
};
const backend = originOf(env.VITE_STELLA_BACKEND_URL);

const firstVisitLook = (isDark: boolean): StaticHomeLook => {
  const custom = getThemeById("custom");
  if (!custom) throw new Error("The theme catalog has no custom theme.");
  const { colors, forcedMode, flat } = resolveThemeColors(custom, isDark, custom.base);
  const dark = forcedMode ? forcedMode === "dark" : isDark;
  return { ...staticHomeLook(buildTokens({ themeId: custom.id, colors, dark, flat })), dark: isDark };
};

function staticHomeMarkup(): string {
  const icon = (data: { body: string; name: string; view: number }) => withStroke(data, 1.75).body;
  return fs.readFileSync(path.join(WEB, "static-home", "shell.html"), "utf8")
    .replace("__STELLA_ICON_PLUS__", () => icon(Icons.stella.Plus))
    .replace("__STELLA_ICON_MIC__", () => icon(Icons.stella.Mic))
    .replace("__STELLA_ICON_SEND__", () => icon(Icons.stella.ArrowUp))
    .replace("__STELLA_LOOK_KEY__", () => STATIC_HOME_LOOK_KEY)
    .replace("__STELLA_FIRST_VISIT__", () => JSON.stringify({ dark: firstVisitLook(true), light: firstVisitLook(false) }));
}
const staticHome = !process.argv.includes("--no-static-home");
const publicDir = path.join(UI_ROOT, "public");
let html = fs.readFileSync(path.join(UI_ROOT, "index.html"), "utf8");
const entryTag = /<script\s+type="module"\s+src="([^"]+)"><\/script>/.exec(html);
if (!entryTag) throw new Error("index.html has no module script entry.");
const entryScript = `<script type="module" crossorigin src="./${rel(entry.path)}"></script>`;
const entryPreload = `<link rel="modulepreload" crossorigin href="./${rel(entry.path)}">`;
/** Runs the app once the static home has painted: a cached bundle would otherwise run before the first frame. */
const entryAfterPaint = `<script>(()=>{let started=false;const start=()=>{if(started)return;started=true;const s=document.createElement("script");s.type="module";s.crossOrigin="anonymous";s.src=${JSON.stringify(`./${rel(entry.path)}`)};document.head.appendChild(s)};requestAnimationFrame(()=>setTimeout(start,0));setTimeout(start,100)})()</script>`;
if (staticHome) {
  const markup = staticHomeMarkup();
  html = html.replace(/(\s*)<div id="root">/, (match, indent: string) => `${indent}${markup.trim().split("\n").join(indent)}${match}`);
}
html = html
  .replace(LAUNCH_RESCUE, "")
  .replace(entryTag[0], () => (staticHome ? "" : entryScript))
  .replace(/(url\(\s*"|href=")\/(src\/[^"]+)"/g, (_m, head: string, ref: string) => `${head}./${emitFile(path.join(UI_ROOT, ref))}"`)
  .replace(/(<(?:link|script|img)\b[^>]*?\s(?:href|src)=")\/([^"]*)"/g, (match, head: string, ref: string) => (fs.existsSync(path.join(publicDir, ref)) ? `${head}./${ref}"` : match))
  .replace("</head>", [
    ...(backend ? [`  <link rel="preconnect" href="${backend}" crossorigin="anonymous">`] : []),
    `  <link rel="stylesheet" href="./${fontCssFile}">`,
    ...(staticHome ? [`  ${entryPreload}`] : []),
    "</head>",
  ].join("\n  "))
  .replace("</body>", () => (staticHome ? `  ${entryAfterPaint}\n  </body>` : "</body>"));
if (staticHome) scriptSources.push(...[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash("sha256").update(m[1]!).digest("base64")}'`));
if (scriptSources.length) html = html.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*?script-src )/, (m) => `${m}${scriptSources.join(" ")} `);
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, CANVAS_HOST_FILE), CANVAS_HOST_HTML);
fs.cpSync(publicDir, outDir, { recursive: true });

const files = (fs.readdirSync(outDir, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(outDir, f)).isFile());
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
for (const log of app.logs) if (log.level === "error") console.error(String(log));
console.log(`[rune-web] ${app.outputs.length} outputs, ${files.length} files, ${(bytes / 1048576).toFixed(2)} MB in ${Date.now() - startedAt}ms → ${outDir}`);
