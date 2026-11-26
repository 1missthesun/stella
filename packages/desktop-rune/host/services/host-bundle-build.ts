// Builds the host bundle (host-bundle.ts) from the sources as they are and records it, unless a
// file it read changed while it built.

import path from "node:path";
import { hostBundlePlugin } from "../electron/plugin";
import { buildFolder, discardFolder, recordBuild, stampAll } from "./source-stamps";
import { HOST_CACHE_DIR, hostBundleKey } from "./host-bundle";

const ENTRY = path.resolve(import.meta.dir, "../app.tsx");
const BUILD_TOOLS = ["host-bundle-build.ts", "host-bundle.ts", "source-stamps.ts", "../electron/plugin.ts", "../main.tsx"].map((f) => path.resolve(import.meta.dir, f));

const startedAt = Date.now();
const externals = new Set<string>();
const pageInputs = new Set<string>();
const folder = await buildFolder(HOST_CACHE_DIR);
const result = await Bun.build({
  entrypoints: [ENTRY],
  target: "bun",
  format: "cjs",
  bytecode: true,
  sourcemap: "external",
  outdir: folder.path,
  external: ["react", "react/*", "*.node"],
  plugins: [await hostBundlePlugin(externals, pageInputs)],
  metafile: true,
} as Parameters<typeof Bun.build>[0]);
const file = result.outputs.find((o) => o.path.endsWith(".js"))?.path;
const inputs = Object.keys((result as { metafile?: { inputs: Record<string, unknown> } }).metafile?.inputs ?? {})
  .filter((f) => !f.includes(":"))
  .map((f) => path.resolve(f));
const bytecode = file ? await Bun.file(`${file}.jsc`).exists() : false;
const stamps = result.success && file ? await stampAll([...inputs, ...pageInputs, ...externals], BUILD_TOOLS) : null;
const changedWhileBuilding = !stamps || Object.values(stamps).some((stamp) => Number(stamp.split(":")[0]) > startedAt);
if (!result.success || !file || !bytecode || !stamps || changedWhileBuilding) {
  if (!result.success) console.error("[host] host bundle build failed:", result.logs.map(String).join("\n"));
  else if (!bytecode) console.error("[host] the host bundle came out without bytecode");
  await discardFolder(folder.path);
  process.exit(1);
}
const mapFile = `${file}.map`;
const map = JSON.parse(await Bun.file(mapFile).text()) as { sourcesContent?: unknown[] };
map.sourcesContent = map.sourcesContent?.map(() => null);
await Bun.write(mapFile, JSON.stringify(map));
await recordBuild(HOST_CACHE_DIR, folder.name, path.basename(file), hostBundleKey(), stamps);
console.error(`[host] host bundle built in ${Date.now() - startedAt} ms (${inputs.length} files)`);
