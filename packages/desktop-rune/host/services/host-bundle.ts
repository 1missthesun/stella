// The host bundle: host/app.tsx with master's Electron main and the workspace sources it imports,
// as one Bun bytecode file in packages/desktop-rune/.cache/host (built by host-bundle-build.ts in
// a child after a boot from source). It is used only while its stamps match (source-stamps.ts):
// any change to the host, master's main or a dependency boots from source and builds it again.

import { setPriority } from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";
import { currentBuild, stampOf } from "./source-stamps";

export const HOST_CACHE_DIR = path.resolve(import.meta.dir, "../../.cache/host");
const BUILDER = path.join(import.meta.dir, "host-bundle-build.ts");

export const hostBundleKey = () => JSON.stringify({ bun: `${Bun.version}+${Bun.revision}`, platform: process.platform, arch: process.arch });

export async function currentHostBundle(): Promise<string | null> {
  if (process.env.STELLA_RUNE_HOST_BUNDLE === "0") return null;
  const build = await currentBuild(HOST_CACHE_DIR).catch(() => null);
  if (!build || build.key !== hostBundleKey()) return null;
  return (await stampOf(build.file)) && (await stampOf(`${build.file}.jsc`)) ? build.file : null;
}

let builder: Subprocess | null = null;

/** Builds the host bundle in a child at low priority, unless one is current or building. */
export async function buildHostBundle(): Promise<void> {
  if (builder || process.env.STELLA_RUNE_HOST_BUNDLE === "0" || (await currentHostBundle())) return;
  const child = Bun.spawn([process.execPath, BUILDER], { cwd: path.dirname(BUILDER), env: process.env, stdio: ["ignore", "ignore", "inherit"] });
  builder = child;
  try { setPriority(child.pid, 10); } catch {}
  const stop = () => child.kill();
  process.once("exit", stop);
  await child.exited;
  process.off("exit", stop);
  builder = null;
}
