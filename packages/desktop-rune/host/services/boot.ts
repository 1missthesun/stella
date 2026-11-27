// Host services for the windowed app: Electron main under the shim, then the browser globals and
// `window.electronAPI` of its main window, kept in step with that window (focus, visibility,
// size, OS appearance), as preload.ts and Chromium provide them in Electron.

import { installDom, type DomHost } from "../dom";
import { hostWindows, openWindowFrom, type BrowserWindow } from "../electron/browser-window";
import { engine } from "../electron/engine";
import { clipboard, nativeTheme, shell } from "../electron/native";
import { nativeImage } from "../electron/native-image";
import { primaryDisplaySync } from "../electron/screen";
import { RendererIpc } from "../electron/ipc";
import { installQuitHandling } from "./quit";
import { bootElectronMain, type ElectronMainOptions } from "./electron-main";
import { scopeDisposerMethod } from "./ui-scope";
import { bootMark } from "./boot-trace";
import { firstAppWindow, rendererApiFor, uiStateSnapshot, type ElectronApi } from "./renderer-api";

export type RuneServices = { api: ElectronApi; window: BrowserWindow; dom: DomHost };

const viewportOf = (win: BrowserWindow) => {
  const bounds = win.getBounds();
  return { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, devicePixelRatio: primaryDisplaySync().scaleFactor };
};

export async function bootRuneServices(options: ElectronMainOptions): Promise<RuneServices> {
  scopeDisposerMethod(RendererIpc.prototype, "on");
  await bootElectronMain(options);
  installQuitHandling();
  bootMark("main-ready");
  const win = await firstAppWindow();
  bootMark("first-window");
  if (engine()) hostWindows.bindMain(win);
  const contents = win.webContents;
  const api = rendererApiFor(contents);

  const dom = installDom({
    url: contents.getURL(),
    appearance: { dark: nativeTheme.shouldUseDarkColors },
    viewport: viewportOf(win),
    uiState: {
      snapshot: () => uiStateSnapshot(contents),
      apply: (changes) => api.uiState.apply(changes),
      clear: () => api.uiState.clear(),
      onChanged: (listener) => api.uiState.onChanged(listener),
    },
    clipboard: {
      readText: async () => (await engine()?.clipboard.readText().catch(() => null)) ?? clipboard.readText(),
      writeText: async (text) => clipboard.writeText(text),
      readImagePng: async () => {
        const png = await engine()?.clipboard.readImage().catch(() => null);
        return png ? new Uint8Array(png) : null;
      },
      writeImagePng: async (png) => clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png))),
    },
    openExternal: (url) => void shell.openExternal(url),
    open: (url, target, features) => { openWindowFrom(win, url, target, features); return null; },
    reload: () => contents.reload(),
  });

  const g = globalThis as Record<string, unknown>;
  g.electronAPI = api;
  Object.defineProperty(g, "__stellaUiState", { configurable: true, get: () => uiStateSnapshot(contents) });

  nativeTheme.on("updated", () => dom.setAppearance({ dark: nativeTheme.shouldUseDarkColors }));
  win.on("focus", () => dom.setFocused(true));
  win.on("blur", () => dom.setFocused(false));
  dom.setFocused(win.isFocused());
  win.on("show", () => dom.setVisible(true));
  win.on("hide", () => dom.setVisible(false));
  win.on("minimize", () => dom.setVisible(false));
  win.on("restore", () => dom.setVisible(true));
  win.on("resize", () => dom.setViewport(viewportOf(win)));
  win.on("move", () => dom.setViewport(viewportOf(win)));

  bootMark("dom");
  return { api, window: win, dom };
}
