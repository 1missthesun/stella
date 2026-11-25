// Boots master's Electron main (packages/desktop/electron) inside the host under the `electron`
// shim. The ordering matches Electron's: the entry's top level runs before `ready`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "../electron/app";
import { installElectronPlugin } from "../electron/plugin";
import { installFdSockets } from "../electron/fd-socket";
import { refreshDisplays } from "../electron/screen";
import { attachEngine, engine, onEngine } from "../electron/engine";
import { nativeTheme } from "../electron/native";
import { applyUiEnv } from "./ui-env";

export const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const ELECTRON_ENTRY = path.join(REPO_ROOT, "packages/desktop/electron/main.ts");

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
  applyUiEnv();
  installFdSockets();
  installElectronPlugin();

  const live = engine();
  if (live) {
    await Promise.all([
      refreshDisplays(),
      live.appearance.get().then((a) => nativeTheme.setSystemAppearance(a.dark)).catch(() => {}),
    ]);
  }
  onEngine("appearance", (a) => nativeTheme.setSystemAppearance(a.dark));

  await import(ELECTRON_ENTRY);
  await new Promise((resolve) => setImmediate(resolve));
  app.markReady();
  console.error(`[host] Electron main evaluated in ${(performance.now() - started).toFixed(0)} ms`);
}
