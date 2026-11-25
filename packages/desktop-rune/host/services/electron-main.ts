// Boots master's Electron main (packages/desktop/electron) inside the host under the `electron`
// shim. The ordering matches Electron's: the entry's top level runs before `ready`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "../electron/app";
import { installElectronPlugin } from "../electron/plugin";
import { refreshDisplays } from "../electron/screen";
import { attachEngine, onEngine } from "../electron/engine";
import { nativeTheme } from "../electron/native";

export const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const ELECTRON_ENTRY = path.join(REPO_ROOT, "packages/desktop/electron/main.ts");
const DESKTOP_UI = path.join(REPO_ROOT, "packages/desktop-ui");

const parseEnv = (source: string) => {
  const out: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let value = m[2]!.trim();
    if (/^(["'`]).*\1$/.test(value)) value = value.slice(1, -1);
    out[m[1]!] = value;
  }
  return out;
};

/** The build-time defines esbuild bakes into Electron main's bundle, read at runtime instead. */
const applyBundleDefines = () => {
  if (process.env.VITE_TURNSTILE_SITE_KEY) return;
  const mode = process.env.NODE_ENV || "development";
  for (const name of [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]) {
    try {
      const key = parseEnv(readFileSync(path.join(DESKTOP_UI, name), "utf8")).VITE_TURNSTILE_SITE_KEY;
      if (key) process.env.VITE_TURNSTILE_SITE_KEY = key;
    } catch {}
  }
  process.env.VITE_TURNSTILE_SITE_KEY ??= "";
};

export type ElectronMainOptions = {
  /** The engine bridge module (host/bridge.ts); absent when the host runs headless. */
  bridge?: Parameters<typeof attachEngine>[0];
  /** Ends the whole app: the host tells the engine to quit, then exits. */
  exit(code: number): void;
};

export async function bootElectronMain(options: ElectronMainOptions): Promise<void> {
  const started = performance.now();
  if (options.bridge) attachEngine(options.bridge);
  const rootPackage = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version?: string };
  app.configure({ appPath: REPO_ROOT, version: rootPackage.version });
  app.hooks.exit = options.exit;
  (process as { resourcesPath?: string }).resourcesPath ??= path.join(REPO_ROOT, "packages/desktop/resources");
  applyBundleDefines();
  installElectronPlugin();

  if (options.bridge?.engine) {
    await Promise.all([
      refreshDisplays(),
      options.bridge.engine.appearance.get().then((a) => nativeTheme.setSystemAppearance(a.dark)).catch(() => {}),
    ]);
  }
  onEngine("appearance", (a) => nativeTheme.setSystemAppearance(a.dark));

  await import(ELECTRON_ENTRY);
  await new Promise((resolve) => setImmediate(resolve));
  app.markReady();
  console.error(`[host] Electron main evaluated in ${(performance.now() - started).toFixed(0)} ms`);
}
