export type NativeMenuItem = { id?: string; label?: string; type?: "normal" | "separator" | "checkbox" | "submenu"; enabled?: boolean; checked?: boolean; accelerator?: string; submenu?: NativeMenuItem[] };

type EngineApi = {
  fonts: (f: { files: string[]; sans?: string; mono?: string }) => Promise<unknown>;
  colorMotion: (dur: number) => Promise<unknown>;
  menu: { popup: (items: NativeMenuItem[], at: { window?: string; x?: number; y?: number; anchor?: string }) => Promise<string | null> };
  clipboard: { writeText: (text: string) => Promise<unknown> };
};

const api = () => (globalThis as { stella?: { engine?: EngineApi } }).stella?.engine;

/** The engine calls the kit makes (host/bridge's `engine`), absent when the kit renders elsewhere. */
export const engine = {
  colorMotion(dur: number) {
    void api()?.colorMotion(dur);
  },
  fonts(files: string[], sans: string, mono: string) {
    void api()?.fonts({ files, sans, mono });
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
};
