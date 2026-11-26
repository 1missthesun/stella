// The UI boot bundle (source-stamps.ts): the last good build of the UI entry as Bun bytecode in
// packages/desktop-rune/.cache/ui. Boot loads it only while its stamps match, so an edit, an
// app-source update, an undo or a dependency change rebuilds through the builder child, which
// writes the next one after builds settle. Hot swaps never read it.

import path from "node:path";
import { buildFolder, currentBuild, discardFolder, recordBuild, stampAll, stampOf } from "./source-stamps";
import { uiBuildMode } from "./ui-mode";

const UI_CACHE_DIR = path.resolve(import.meta.dir, "../../.cache/ui");
const BUILD_TOOLS = ["../vite-compat.ts", "ui-build-child.ts", "ui-cache.ts", "source-stamps.ts", "ui-env.ts", "ui-mode.ts", "../../tsconfig.build.json"].map((f) => path.resolve(import.meta.dir, f));

export type UiCacheSpec = { entry: string; tsconfig: string; external: string[] };

export function uiCacheKey(spec: UiCacheSpec): string {
  const env = Object.entries(process.env).filter(([k]) => k.startsWith("VITE_") || k === "STELLA_UI_BASE_URL").sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify({ bun: `${Bun.version}+${Bun.revision}`, platform: process.platform, arch: process.arch, mode: uiBuildMode(), entry: spec.entry, tsconfig: spec.tsconfig, external: spec.external, env });
}

/** The boot bundle when it was built from exactly the files there now; its key is checked at load (the env settles during boot). */
export async function validUiCache(): Promise<{ file: string; key: string } | null> {
  const build = await currentBuild(UI_CACHE_DIR);
  if (!build || !(await stampOf(build.file)) || !(await stampOf(`${build.file}.jsc`))) return null;
  return { file: build.file, key: build.key };
}

/**
 * Builds the boot bundle from the files as they are and records it, unless a file changed while
 * it built (`inputs` are the last build's, stamped before this one starts).
 */
export async function writeUiCache(spec: UiCacheSpec, inputs: string[], build: (outdir: string, footer: string) => Promise<{ inputs: string[]; file: string } | null>): Promise<boolean> {
  const before = await stampAll(inputs, BUILD_TOOLS);
  if (!before) return false;
  const folder = await buildFolder(UI_CACHE_DIR);
  const built = await build(folder.path, `//# sourceURL=${spec.entry}?swap=1`).catch(() => null);
  const after = built ? await stampAll(built.inputs, BUILD_TOOLS) : null;
  if (!built || !after || Object.entries(after).some(([file, stamp]) => before[file] !== stamp)) {
    await discardFolder(folder.path);
    return false;
  }
  await recordBuild(UI_CACHE_DIR, folder.name, path.basename(built.file), uiCacheKey(spec), after);
  return true;
}
