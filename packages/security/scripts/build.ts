/** Bundles Stella Security into dist/: Electron main + preload (Node) and the window (browser). */
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, "renderer"), { recursive: true });

const common = { bundle: true, sourcemap: "linked" as const, logLevel: "warning" as const, legalComments: "none" as const };
await Promise.all([
  build({ ...common, entryPoints: [path.join(root, "src/app/main.ts")], outfile: path.join(dist, "main.cjs"), platform: "node", format: "cjs", target: "node22", external: ["electron", "bun:sqlite"] }),
  build({ ...common, entryPoints: [path.join(root, "src/app/preload.ts")], outfile: path.join(dist, "preload.cjs"), platform: "node", format: "cjs", target: "node22", external: ["electron"] }),
  build({ ...common, entryPoints: [path.join(root, "src/app/renderer/app.tsx")], outfile: path.join(dist, "renderer/app.js"), platform: "browser", format: "iife", target: "chrome130", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, minify: true }),
]);
for (const f of ["index.html", "style.css", "mona-sans.woff2"]) cpSync(path.join(root, "src/app/renderer", f), path.join(dist, "renderer", f));
cpSync(path.join(root, "assets/icon.png"), path.join(dist, "icon.png"));
console.log("built", dist);
