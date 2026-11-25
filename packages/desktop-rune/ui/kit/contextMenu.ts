export type NativeMenuItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accel?: string; submenu?: NativeMenuItem[] }
  | { separator: true };

type MenuApi = { popup(items: NativeMenuItem[], at: { x: number; y: number } | { anchor: string }): Promise<string | null> };

const menuApi = (): MenuApi | undefined => (globalThis as { stella?: { engine?: { menu?: MenuApi } } }).stella?.engine?.menu;

/**
 * Shows a native context menu (desktop-ui's platform context menus) at a point or under an element,
 * and runs the chosen item's handler. Resolves with the chosen id, or null when dismissed.
 */
export async function showContextMenu(items: Array<NativeMenuItem & { run?: () => void }>, at: { x: number; y: number } | { anchor: string }): Promise<string | null> {
  const api = menuApi();
  if (!api) return null;
  const strip = (list: Array<NativeMenuItem & { run?: () => void }>): NativeMenuItem[] =>
    list.map((it) => ("separator" in it ? it : { id: it.id, label: it.label, enabled: it.enabled, checked: it.checked, accel: it.accel, ...(it.submenu ? { submenu: strip(it.submenu) } : {}) }));
  const chosen = await api.popup(strip(items), at);
  if (chosen) {
    const find = (list: Array<NativeMenuItem & { run?: () => void }>): (() => void) | undefined => {
      for (const it of list) {
        if ("separator" in it) continue;
        if (it.id === chosen) return it.run;
        const sub = it.submenu && find(it.submenu);
        if (sub) return sub;
      }
      return undefined;
    };
    find(items)?.();
  }
  return chosen;
}
