import type { engine as BridgeEngine, MenuItem } from "../../host/bridge";

export type NativeMenuItem = MenuItem;

const api = (): typeof BridgeEngine | undefined => (globalThis as { stella?: { engine?: typeof BridgeEngine } }).stella?.engine;

/** The engine calls the kit makes (host/bridge's `engine`); each is a no-op where the kit renders without the engine. */
export const engine = {
  colorMotion(dur: number) {
    void api()?.colorMotion(dur);
  },
  fonts(files: string[], sans: string, mono: string) {
    void api()?.fonts({ files, sans, mono });
  },
  /** After the commit that mounts the window, so the engine has a window to paint. */
  background(color: string) {
    setTimeout(() => void api()?.background(color).catch(() => {}), 0);
  },
  popupMenu(items: NativeMenuItem[], at: { window?: string; x?: number; y?: number; anchor?: string }): Promise<string | null> {
    return api()?.menu.popup(items, at) ?? Promise.resolve(null);
  },
  async writeText(text: string): Promise<boolean> {
    const e = api();
    if (!e) return false;
    await e.clipboard.writeText(text);
    return true;
  },
  /** Asks where to save `text` and writes it there; false when cancelled or without the engine. */
  async saveText(text: string, defaultName: string): Promise<boolean> {
    const e = api();
    if (!e) return false;
    const path = await e.dialog.saveFile({ defaultPath: defaultName });
    if (!path) return false;
    await Bun.write(path, text);
    return true;
  },
};
