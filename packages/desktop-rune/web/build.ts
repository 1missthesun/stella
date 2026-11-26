// The web build of ui/ (stella.sh/chat's /chat-app): the Rune UI on the DOM host (web/dom), with
// desktop-ui's web page around it (index.html, public/, fonts, canvas host) and its web env.
// bun packages/desktop-rune/web/build.ts [--out <dir>] [--script-src <source>]...

import type { BunPlugin } from "bun";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CANVAS_HOST_FILE, CANVAS_HOST_HTML } from "@stella/contracts/canvas-host";
import { webBuildEnv } from "../../desktop/electron/source/build-web";
import { replacementFor, resolveSpecifier, viteCompat } from "../host/vite-compat";

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

const app = await Bun.build({
  entrypoints: [path.join(WEB, "entry.ts")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: !process.argv.includes("--no-minify"),
  sourcemap: "none",
  naming: { entry: `${ASSETS}/[name]-[hash].[ext]`, chunk: `${ASSETS}/[name]-[hash].[ext]`, asset: `${ASSETS}/[name]-[hash].[ext]` },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.hot": "undefined" },
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
fs.writeFileSync(fontCss.path, fs.readFileSync(fontCss.path, "utf8").replace(/url\("?\.\/assets\//g, (m) => m.replace("./assets/", "./")));

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

const originOf = (value: unknown) => {
  try {
    return typeof value === "string" && value.trim() ? new URL(value.trim()).origin : null;
  } catch {
    return null;
  }
};
const backend = originOf(env.VITE_STELLA_BACKEND_URL);
const publicDir = path.join(UI_ROOT, "public");
let html = fs.readFileSync(path.join(UI_ROOT, "index.html"), "utf8");
const entryTag = /<script\s+type="module"\s+src="([^"]+)"><\/script>/.exec(html);
if (!entryTag) throw new Error("index.html has no module script entry.");
html = html
  .replace(LAUNCH_RESCUE, "")
  .replace(entryTag[0], () => `<script type="module" crossorigin src="./${rel(entry.path)}"></script>`)
  .replace(/(url\(\s*"|href=")\/(src\/[^"]+)"/g, (_m, head: string, ref: string) => `${head}./${emitFile(path.join(UI_ROOT, ref))}"`)
  .replace(/(<(?:link|script|img)\b[^>]*?\s(?:href|src)=")\/([^"]*)"/g, (match, head: string, ref: string) => (fs.existsSync(path.join(publicDir, ref)) ? `${head}./${ref}"` : match))
  .replace("</head>", [
    ...(backend ? [`  <link rel="preconnect" href="${backend}" crossorigin="anonymous">`] : []),
    `  <link rel="stylesheet" href="./${rel(fontCss.path)}">`,
    "</head>",
  ].join("\n  "));
if (scriptSources.length) html = html.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*?script-src )/, (m) => `${m}${scriptSources.join(" ")} `);
fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.writeFileSync(path.join(outDir, CANVAS_HOST_FILE), CANVAS_HOST_HTML);
fs.cpSync(publicDir, outDir, { recursive: true });

const files = (fs.readdirSync(outDir, { recursive: true }) as string[]).filter((f) => fs.statSync(path.join(outDir, f)).isFile());
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
for (const log of app.logs) if (log.level === "error") console.error(String(log));
console.log(`[rune-web] ${app.outputs.length} outputs, ${files.length} files, ${(bytes / 1048576).toFixed(2)} MB in ${Date.now() - startedAt}ms → ${outDir}`);
