// The Bun runtime plugin that lets master's Electron main run unchanged in the host: `electron`
// (and electron/main, electron/common) resolve to the shim, `browser-script:` imports become the
// bundled page script text, as esbuild's browser-script plugin builds them for Electron.

import { plugin } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { electronModule } from "./index";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const ELECTRON_DIR = path.join(REPO_ROOT, "packages/desktop/electron");
const BROWSER_SCRIPT = /["']browser-script:([^"']+)["']/g;
/** Electron main runs from an esbuild bundle in this folder; its path math assumes it. */
const BUNDLE_DIR = path.join(REPO_ROOT, "packages/desktop/dist-electron/electron");
/** Electron main exports Rune replaces: Chromium-only machinery with a Rune counterpart. */
const OVERRIDES: Array<{ file: string; name: string; from: string }> = [
  { file: "source/renderer-protocol.ts", name: "serveRendererSource", from: path.resolve(import.meta.dir, "../services/renderer-source.ts") },
];

const applyOverrides = (file: string, source: string) => {
  for (const o of OVERRIDES) {
    if (path.join(ELECTRON_DIR, o.file) !== file) continue;
    const declaration = `export const ${o.name} =`;
    if (!source.includes(declaration)) throw new Error(`Rune override: ${o.file} no longer declares \`${declaration}\``);
    source = source.replace(declaration, `const __electron_${o.name} =`);
    source += `\nexport { ${o.name} } from ${JSON.stringify(o.from)};\n`;
  }
  return source;
};

const ELECTRON_SOURCE = new RegExp(`^${ELECTRON_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?!.*\\.page\\.ts$).*\\.(ts|js)$`);

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
      build.onLoad({ filter: ELECTRON_SOURCE }, (args) => {
        let source = applyOverrides(args.path, readFileSync(args.path, "utf8"));
        source = source.replaceAll("import.meta.dirname", JSON.stringify(BUNDLE_DIR));
        if (/\b__dirname\b/.test(source) && !/\b(?:const|let|var)\s+__dirname\b/.test(source)) {
          source = `const __dirname = ${JSON.stringify(BUNDLE_DIR)};\n${source}`;
        }
        return { contents: source, loader: args.path.endsWith(".js") ? "js" : "ts" };
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
