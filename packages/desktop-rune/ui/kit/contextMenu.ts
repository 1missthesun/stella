import { engine, type NativeMenuItem } from "./engine";

export type ContextMenuItem =
  | { id: string; label: string; enabled?: boolean; checked?: boolean; accelerator?: string; run?: () => void; submenu?: ContextMenuItem[] }
  | { separator: true };

function toNative(list: ContextMenuItem[]): NativeMenuItem[] {
  return list.map((it) =>
    "separator" in it
      ? { type: "separator" }
      : {
          id: it.id,
          label: it.label,
          enabled: it.enabled,
          checked: it.checked,
          accelerator: it.accelerator,
          ...(it.checked !== undefined ? { type: "checkbox" as const } : {}),
          ...(it.submenu ? { type: "submenu" as const, submenu: toNative(it.submenu) } : {}),
        },
  );
}

function handlerFor(list: ContextMenuItem[], id: string): (() => void) | undefined {
  for (const it of list) {
    if ("separator" in it) continue;
    if (it.id === id) return it.run;
    const sub = it.submenu && handlerFor(it.submenu, id);
    if (sub) return sub;
  }
  return undefined;
}

/**
 * Shows a native context menu (desktop-ui's platform context menus) at a window point or under an
 * element, and runs the chosen item's handler. Resolves with the chosen id, or null when dismissed.
 */
export async function showContextMenu(items: ContextMenuItem[], at: { x: number; y: number; window?: string } | { anchor: string; window?: string }): Promise<string | null> {
  const chosen = await engine.popupMenu(toNative(items), at);
  if (chosen) handlerFor(items, chosen)?.();
  return chosen;
}
