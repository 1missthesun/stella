import type { MenuBuilder, MenuItem, MenuSection } from "@/platform/context-menu";
import { showContextMenu, type ContextMenuItem } from "../kit";

const NO_TARGET = { closest: () => null, matches: () => false } as unknown as Element;

const toItems = (items: MenuItem[], prefix: string): ContextMenuItem[] =>
  items.map((item, i) => {
    if (item === "separator") return { separator: true };
    const id = `${prefix}${i}`;
    if ("items" in item) return { id, label: item.label, enabled: item.enabled, submenu: toItems(item.items, `${id}.`) };
    return { id, label: item.label, enabled: item.enabled, checked: item.checked, run: () => void item.run() };
  });

/** Pops up a desktop-ui `MenuBuilder`'s sections as a native context menu at a window point. */
export async function popupMenuBuilder(build: MenuBuilder, at: { x: number; y: number; window?: string }): Promise<void> {
  const built = await build({ target: NO_TARGET, selectionText: "", isEditable: false, claimed: new Set() });
  if (!built || built.length === 0) return;
  const sections = (Array.isArray(built[0]) ? built : [built]) as MenuSection[];
  const items: ContextMenuItem[] = [];
  sections.forEach((section, i) => {
    if (section.length === 0) return;
    if (items.length > 0) items.push({ separator: true });
    items.push(...toItems(section, `s${i}.`));
  });
  if (items.length > 0) await showContextMenu(items, at);
}
