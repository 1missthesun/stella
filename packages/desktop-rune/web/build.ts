// The web build of ui/ (stella.sh/chat's /chat-app): the Rune UI on the DOM host (web/dom), with
// desktop-ui's web page around it (index.html, public/, fonts, canvas host) and its web env.
// bun packages/desktop-rune/web/build.ts [--out <dir>] [--script-src <source>]... [--no-minify] [--no-static-home]

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CANVAS_HOST_FILE, CANVAS_HOST_HTML } from "@stella/contracts/canvas-host";
import { webBuildEnv } from "../../desktop/electron/source/build-web";
import { getThemeById, resolveThemeColors } from "@stella/theme";
import { Icons, withStroke } from "../ui/kit/icons";
import { buildTokens } from "../ui/theme/tokens";
import { STATIC_HOME_LOOK_KEY, staticHomeLook, type StaticHomeLook } from "./static-home/palette";
import { buildFonts, buildViewWorker, REPO, UI_ROOT, viteCompat, WEB, webPlugin } from "./build-plugin";

const ASSETS = "assets";
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

const startedAt = Date.now();
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, ASSETS), { recursive: true });

// A Stella View's worker (web/views/view-worker.ts) is its own bundle beside the app's chunks; the app
// finds it by the name defined below.
const viewWorkerFile = await buildViewWorker(path.join(outDir, ASSETS), !process.argv.includes("--no-minify"));

const app = await Bun.build({
  entrypoints: [path.join(WEB, "entry.ts")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  splitting: true,
  minify: !process.argv.includes("--no-minify"),
  sourcemap: "none",
  naming: { entry: `${ASSETS}/[name]-[hash].[ext]`, chunk: `${ASSETS}/[name]-[hash].[ext]`, asset: `${ASSETS}/[name]-[hash].[ext]` },
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.hot": "undefined", __STELLA_VIEW_WORKER__: JSON.stringify(viewWorkerFile) },
  plugins: [webPlugin, viteCompat],
  throw: false,
});
if (!app.success) {
  for (const log of app.logs) console.error(String(log));
  throw new Error("The Rune web build failed.");
}

const { css: fontCssFile, emitFile } = await buildFonts(outDir, ASSETS);

const rel = (file: string) => path.relative(outDir, file).split(path.sep).join("/");
const entry = app.outputs.find((o) => o.kind === "entry-point");
if (!entry) throw new Error("The build produced no entry.");

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
