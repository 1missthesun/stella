// `window.electronAPI` for a window's React tree: master's createElectronApi over the in-process
// renderer IPC of that window's WebContents (what preload.ts builds over Chromium IPC).

import { createElectronApi } from "@stella/contracts/desktop/electron-api";
import type { TypedIpcRenderer } from "@stella/contracts/desktop/ipc-contract";
import { IPC_UI_STATE_KV_SNAPSHOT } from "@stella/contracts/desktop/ipc-channels";
import { BrowserWindow, hostWindows } from "../electron/browser-window";
import type { WebContents } from "../electron/web-contents";

export type ElectronApi = ReturnType<typeof createElectronApi>;

const apis = new WeakMap<WebContents, ElectronApi>();

export function typedIpcFor(contents: WebContents): TypedIpcRenderer {
  const ipc = contents.ipc;
  return {
    invoke: ((channel: string, ...args: unknown[]) => ipc.invoke(channel, ...args)) as TypedIpcRenderer["invoke"],
    send: ((channel: string, ...args: unknown[]) => ipc.send(channel, ...args)) as TypedIpcRenderer["send"],
    sendSync: ((channel: string, ...args: unknown[]) => ipc.sendSync(channel, ...args)) as TypedIpcRenderer["sendSync"],
    on: ((channel: string, listener: (event: unknown, payload: unknown) => void) => ipc.on(channel, (event, payload) => listener(event, payload))) as TypedIpcRenderer["on"],
  };
}

export function rendererApiFor(contents: WebContents): ElectronApi {
  let api = apis.get(contents);
  if (!api) {
    api = createElectronApi(typedIpcFor(contents), {
      platform: process.platform,
      getPathForFile: (file) => (file as { path?: string }).path ?? "",
    });
    apis.set(contents, api);
  }
  return api;
}

export function uiStateSnapshot(contents: WebContents): Record<string, string> {
  try {
    return (contents.ipc.sendSync(IPC_UI_STATE_KV_SNAPSHOT) as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}

const isAppWindow = (w: BrowserWindow, mode: string) => {
  const s = w.snapshot();
  return s.kind === "app" && s.mode === mode;
};

/** Resolves with the first Stella app window Electron main creates (the "full" shell by default). */
export function firstAppWindow(mode = "full", timeoutMs = 60_000): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    const find = () => BrowserWindow.getAllWindows().find((w) => isAppWindow(w, mode));
    const existing = find();
    if (existing) return resolve(existing);
    const timer = setTimeout(() => { off(); reject(new Error(`No ${mode} window after ${timeoutMs} ms`)); }, timeoutMs);
    const off = hostWindows.subscribe(() => {
      const w = find();
      if (!w) return;
      clearTimeout(timer);
      off();
      resolve(w);
    });
  });
}
