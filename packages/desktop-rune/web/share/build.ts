// The page a shared Stella View opens on: the share Worker (workers/canvas-share) serves `page.html`
// from its static assets for each `/c/<slug>` that is a view, with the view's version written in.
// bun packages/desktop-rune/web/share/build.ts [--out <dir>] [--no-minify]
// (workers/canvas-share: `bun run build:view`, which deploys and `wrangler dev` need first.)

import fs from "node:fs";
import path from "node:path";
import { VIEW_SHARE_ASSET_PREFIX, VIEW_SHARE_PAGE_PATH, VIEW_SHARE_PAYLOAD_MARKER, VIEW_SHARE_TITLE_MARKER } from "@stella/contracts/view-share";
import { font } from "../../ui/theme/scale";
import { buildFonts, buildViewWorker, REPO, viteCompat, WEB, webPlugin } from "../build-plugin";

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outRoot = path.resolve(flag("--out") ?? path.join(REPO, "workers", "canvas-share", "view-assets"));
const minify = !process.argv.includes("--no-minify");
const prefix = VIEW_SHARE_ASSET_PREFIX.replace(/^\/|\/$/gu, "");
const outDir = path.join(outRoot, prefix);

process.env.STELLA_UI_BASE_URL = VIEW_SHARE_ASSET_PREFIX;

const startedAt = Date.now();
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const viewWorkerFile = await buildViewWorker(outDir, minify);
const page = await Bun.build({
  entrypoints: [path.join(WEB, "share", "entry.ts")],
  outdir: outDir,
  target: "browser",
  format: "esm",
  splitting: true,
  minify,
  sourcemap: "none",
  naming: "[name]-[hash].[ext]",
  define: { "process.env.NODE_ENV": JSON.stringify("production"), "import.meta.hot": "undefined", __STELLA_VIEW_WORKER__: JSON.stringify(viewWorkerFile) },
  plugins: [webPlugin, viteCompat],
  throw: false,
});
const entry = page.outputs.find((o) => o.kind === "entry-point");
if (!page.success || !entry) {
  for (const log of page.logs) console.error(String(log));
  throw new Error("The shared view page build failed.");
}
const { css: fontCss } = await buildFonts(outDir, ".");
const at = (file: string) => `${VIEW_SHARE_ASSET_PREFIX}${path.relative(outDir, file).split(path.sep).join("/").replace(/^\.\//u, "")}`;
// The sans faces show on first paint; the mono ones load when a view uses them.
const fontFiles = fs.readdirSync(outDir).filter((f) => /\.(woff2?|ttf|otf)$/u.test(f) && !f.includes("mono"));

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="color-scheme" content="light dark" />
    <title>${VIEW_SHARE_TITLE_MARKER}</title>
    <link rel="icon" type="image/svg+xml" href="${VIEW_SHARE_ASSET_PREFIX}stella-logo.svg" />
${fontFiles.map((f) => `    <link rel="preload" as="font" type="font/${path.extname(f).slice(1)}" crossorigin href="${VIEW_SHARE_ASSET_PREFIX}${f}" />`).join("\n")}
    <link rel="stylesheet" href="${at(path.join(outDir, fontCss))}" />
    <style>:root{--rune-sans:"${font.sans}","Manrope Fallback",system-ui,-apple-system,sans-serif;--rune-mono:"${font.mono}",ui-monospace,SFMono-Regular,Menlo,monospace}html,body{margin:0;height:100%}body{background:#fff}@media (prefers-color-scheme:dark){body{background:#111}}#root{height:100%;display:flex}</style>
    ${VIEW_SHARE_PAYLOAD_MARKER}
    <script type="module" src="${at(entry.path)}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;
fs.writeFileSync(path.join(outRoot, VIEW_SHARE_PAGE_PATH.replace(/^\//u, "")), html);
fs.copyFileSync(path.join(REPO, "packages", "desktop-ui", "public", "stella-logo.svg"), path.join(outDir, "stella-logo.svg"));
// Every file but the page is named by its content: cache it for good.
fs.writeFileSync(path.join(outRoot, "_headers"), `${VIEW_SHARE_ASSET_PREFIX}*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n${VIEW_SHARE_PAGE_PATH}\n  Cache-Control: no-cache\n`);

let bytes = 0;
let files = 0;
for (const f of fs.readdirSync(outDir, { recursive: true }) as string[]) {
  const stat = fs.statSync(path.join(outDir, f));
  if (stat.isFile()) {
    bytes += stat.size;
    files += 1;
  }
}
console.log(`[view-share] ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MB in ${Date.now() - startedAt}ms → ${outRoot}`);
