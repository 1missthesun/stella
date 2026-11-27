import { translateNow as t } from "@/shared/i18n";
import type { NativeMenuItem } from "./engine";
import { rune } from "./engine";

export type MenuAction = {
  label: string;
  run: () => void | Promise<unknown>;
  enabled?: boolean;
  checked?: boolean;
};

export type MenuItem = MenuAction | "separator" | { label: string; items: MenuItem[]; enabled?: boolean };

export type MenuSection = MenuItem[];

export type MenuContext = {
  target: Element;
  selectionText: string;
  isEditable: boolean;
  claimed: ReadonlySet<string>;
};

type BuildResult = MenuSection | MenuSection[] | null | undefined | false;

export type MenuBuilder = (context: MenuContext) => BuildResult | Promise<BuildResult>;

type Contribution = { build: MenuBuilder; claims: readonly string[] };
type GlobalBuilder = { build: MenuBuilder; slot: "selection" | "sections" };
type Point = { x: number; y: number; window?: string };
type Capture = { at: Point; contributions: Contribution[] };

const BUILD_TIMEOUT_MS = 260;
const isMac = process.platform === "darwin";

/** Rune has no DOM under the press: shared builders that look for an element (link, code, image, tab) find none, and elements contribute their own items. */
const NO_DOM_TARGET = { closest: () => null } as unknown as Element;

const globals = new Map<string, GlobalBuilder>();
let capture: Capture | null = null;

const quoted = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 28 ? `${flat.slice(0, 27)}…` : flat;
};

const asSections = (result: BuildResult): MenuSection[] => {
  if (!result || result.length === 0) return [];
  const first = result[0];
  return Array.isArray(first) ? (result as MenuSection[]).filter((section) => section.length > 0) : [result as MenuSection];
};

const runBuilder = (build: MenuBuilder, context: MenuContext): Promise<MenuSection[]> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), BUILD_TIMEOUT_MS);
    Promise.resolve()
      .then(() => build(context))
      .then(asSections)
      .then(
        (sections) => {
          clearTimeout(timer);
          resolve(sections);
        },
        (error: unknown) => {
          clearTimeout(timer);
          console.warn("[context-menu] a menu builder failed:", error);
          resolve([]);
        },
      );
  });

const selectionText = async (): Promise<string> => {
  try {
    return (await rune().request<{ text: string }>("selection.get")).text ?? "";
  } catch {
    return "";
  }
};

const copySelection = () => rune().request("selection.copy").catch(() => undefined);

function toNative(items: MenuSection, handlers: Map<string, MenuAction["run"]>): NativeMenuItem[] {
  const out: NativeMenuItem[] = [];
  for (const item of items) {
    if (item === "separator") out.push({ type: "separator" });
    else if ("items" in item) out.push({ type: "submenu", label: item.label, enabled: item.enabled !== false, submenu: toNative(item.items, handlers) });
    else {
      const id = `ctx-${handlers.size}`;
      handlers.set(id, item.run);
      out.push({ id, label: item.label, enabled: item.enabled !== false, ...(typeof item.checked === "boolean" ? { type: "checkbox" as const, checked: item.checked } : {}) });
    }
  }
  return out;
}

const join = (sections: MenuSection[]): MenuSection => {
  const items: MenuSection = [];
  for (const section of sections) {
    if (section.length === 0) continue;
    if (items.length > 0) items.push("separator");
    items.push(...section);
  }
  return items;
};

async function flush() {
  const current = capture;
  capture = null;
  if (!current) return;
  const selection = (await selectionText()).trim();
  const claimed = new Set<string>();
  for (const c of current.contributions) for (const claim of c.claims) claimed.add(claim);
  const context: MenuContext = { target: NO_DOM_TARGET, selectionText: selection, isEditable: false, claimed };
  const own = await Promise.all(current.contributions.map((c) => runBuilder(c.build, context)));
  const shared = await Promise.all([...globals.values()].filter((g) => g.slot === "sections").map((g) => runBuilder(g.build, context)));
  const selectionExtras = await Promise.all([...globals.values()].filter((g) => g.slot === "selection").map((g) => runBuilder(g.build, context)));
  const selectionSection: MenuSection = selection
    ? [
        { label: t("contextMenu.copy"), run: copySelection },
        ...(isMac ? [{ label: t("contextMenu.lookUp", { text: quoted(selection) }), run: () => rune().request("selection.lookUp").catch(() => undefined) }] : []),
        ...selectionExtras.flat().flat(),
      ]
    : [];
  const items = join([selectionSection, ...shared.flat(), ...own.flat()]);
  if (items.length === 0) return;
  const handlers = new Map<string, MenuAction["run"]>();
  const picked = await rune().menu.popup(toNative(items, handlers), current.at);
  if (!picked) return;
  try {
    await handlers.get(picked)?.();
  } catch (error) {
    console.warn("[context-menu] action failed:", error);
  }
}

/** Adds this element's items to the menu its right-click opens; elements under it may add theirs in the same press. */
export const addContextMenu = (at: Point, build: MenuBuilder, options?: { claims?: readonly string[] }): void => {
  if (!capture) {
    capture = { at, contributions: [] };
    setTimeout(() => void flush(), 0);
  }
  capture.contributions.push({ build, claims: options?.claims ?? [] });
};

/** An `onContextMenu` handler: the engine reports the press point, and the native menu opens there. */
export const contextMenu =
  (build: MenuBuilder, options?: { claims?: readonly string[] }) =>
  (at: Point): void =>
    addContextMenu(at, build, options);

export const registerContextMenu = (key: string, build: MenuBuilder, options?: { slot?: "selection" | "sections" }): (() => void) => {
  const entry: GlobalBuilder = { build, slot: options?.slot ?? "sections" };
  globals.set(key, entry);
  return () => {
    if (globals.get(key) === entry) globals.delete(key);
  };
};

export const installContextMenus = (): void => {};
export const trackContextMenus = (_target: unknown): void => {};
