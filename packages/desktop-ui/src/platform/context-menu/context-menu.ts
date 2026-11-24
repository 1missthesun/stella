import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  ContextMenuCollectRequest,
  ContextMenuWireItem,
} from "@stella/contracts/desktop/context-menu";

export type MenuAction = {
  label: string;
  run: () => void | Promise<unknown>;
  enabled?: boolean;
  checked?: boolean;
};

export type MenuItem =
  | MenuAction
  | "separator"
  | { label: string; items: MenuItem[]; enabled?: boolean };

export type MenuSection = MenuItem[];

export type MenuContext = {
  target: Element;
  selectionText: string;
  isEditable: boolean;
  claimed: ReadonlySet<string>;
};

type BuildResult = MenuSection | MenuSection[] | null | undefined | false;

export type MenuBuilder = (
  context: MenuContext,
) => BuildResult | Promise<BuildResult>;

type Contribution = { build: MenuBuilder; claims: readonly string[] };

type Capture = {
  event: Event;
  target: Element;
  at: number;
  contributions: Contribution[];
  consumed: boolean;
};

type GlobalBuilder = {
  build: MenuBuilder;
  slot: "selection" | "sections";
};

type MenuState = {
  capture: Capture | null;
  selectedBeforePress: string | null;
  globals: Map<string, GlobalBuilder>;
  handlers: Map<string, MenuAction["run"]>;
  activeRequestId: number;
  installed: boolean;
  collect: (request: ContextMenuCollectRequest) => Promise<void>;
};

declare global {
  var __stellaContextMenus: MenuState | undefined;
}

const BUILD_TIMEOUT_MS = 260;
const CAPTURE_FRESH_MS = 1500;

/**
 * Things whose right-click is about the thing, not its words. macOS selects
 * the word under a right-click; on these that word isn't what was meant.
 */
const CONTROL_SELECTOR =
  "button, a[href], [role='button'], [role='tab'], [role='option'], " +
  "[role='menuitem'], img, video, stella-file, stella-app";

const state: MenuState = (globalThis.__stellaContextMenus ??= {
  capture: null,
  selectedBeforePress: null,
  globals: new Map(),
  handlers: new Map(),
  activeRequestId: -1,
  installed: false,
  collect: async () => {},
});

const elementOf = (target: EventTarget | null): Element | null =>
  target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;

export const addContextMenu = (
  event: Event | ReactMouseEvent,
  build: MenuBuilder,
  options?: { claims?: readonly string[] },
): void => {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  const capture = state.capture;
  if (!capture || capture.event !== native) return;
  capture.contributions.push({ build, claims: options?.claims ?? [] });
};

export const contextMenu =
  (build: MenuBuilder, options?: { claims?: readonly string[] }) =>
  (event: ReactMouseEvent): void =>
    addContextMenu(event, build, options);

export const registerContextMenu = (
  key: string,
  build: MenuBuilder,
  options?: { slot?: "selection" | "sections" },
): (() => void) => {
  const entry: GlobalBuilder = { build, slot: options?.slot ?? "sections" };
  state.globals.set(key, entry);
  return () => {
    if (state.globals.get(key) === entry) state.globals.delete(key);
  };
};

const asSections = (result: BuildResult): MenuSection[] => {
  if (!result || result.length === 0) return [];
  const first = result[0];
  return Array.isArray(first)
    ? (result as MenuSection[]).filter((section) => section.length > 0)
    : [result as MenuSection];
};

const withTimeout = <T,>(promise: Promise<T>, fallback: T): Promise<T> =>
  new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), BUILD_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        console.warn("[context-menu] a menu builder failed:", error);
        resolve(fallback);
      },
    );
  });

const runBuilder = (build: MenuBuilder, context: MenuContext) =>
  withTimeout(
    Promise.resolve().then(() => build(context)).then(asSections),
    [] as MenuSection[],
  );

const toWire = (
  items: MenuSection,
  register: (run: MenuAction["run"]) => string,
): ContextMenuWireItem[] => {
  const wire: ContextMenuWireItem[] = [];
  for (const item of items) {
    if (item === "separator") {
      wire.push({ type: "separator" });
    } else if ("items" in item) {
      wire.push({
        type: "submenu",
        label: item.label,
        enabled: item.enabled !== false,
        items: toWire(item.items, register),
      });
    } else {
      wire.push({
        type: "action",
        id: register(item.run),
        label: item.label,
        enabled: item.enabled !== false,
        ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
      });
    }
  }
  return wire;
};

const collect = async (request: ContextMenuCollectRequest) => {
  const capture = state.capture;
  const fresh =
    capture &&
    !capture.consumed &&
    performance.now() - capture.at < CAPTURE_FRESH_MS
      ? capture
      : null;
  if (fresh) fresh.consumed = true;
  const target =
    fresh?.target ??
    document.elementFromPoint(request.x, request.y) ??
    document.body;
  const contributions = fresh?.contributions ?? [];
  const before = state.selectedBeforePress;
  state.selectedBeforePress = null;
  const ignoreSelection =
    !request.isEditable &&
    request.selectionText.trim().length > 0 &&
    before !== null &&
    before.trim().length === 0 &&
    target.closest(CONTROL_SELECTOR) !== null;
  if (ignoreSelection) window.getSelection()?.removeAllRanges();
  const context: MenuContext = {
    target,
    selectionText: ignoreSelection ? "" : request.selectionText,
    isEditable: request.isEditable,
    claimed: new Set(contributions.flatMap((entry) => entry.claims)),
  };
  const globals = [...state.globals.values()];
  const [own, selection, shared] = await Promise.all([
    Promise.all(contributions.map((entry) => runBuilder(entry.build, context))),
    Promise.all(
      globals
        .filter((entry) => entry.slot === "selection")
        .map((entry) => runBuilder(entry.build, context)),
    ),
    Promise.all(
      globals
        .filter((entry) => entry.slot === "sections")
        .map((entry) => runBuilder(entry.build, context)),
    ),
  ]);
  const next = new Map<string, MenuAction["run"]>();
  const register = (run: MenuAction["run"]) => {
    const id = `${request.requestId}:${next.size}`;
    next.set(id, run);
    return id;
  };
  const sections = [...shared.flat(), ...own.flat()].map((section) =>
    toWire(section, register),
  );
  const selectionItems = selection
    .flat()
    .flatMap((section) => toWire(section, register));
  state.handlers = next;
  state.activeRequestId = request.requestId;
  window.electronAPI?.contextMenu?.reply({
    requestId: request.requestId,
    selection: selectionItems,
    sections,
    ...(ignoreSelection ? { ignoreSelection } : {}),
  });
};

state.collect = collect;

// The native menu holds focus until it closes; clipboard writes from an
// unfocused page are refused, so give the window a moment to take it back.
const waitForFocus = (): Promise<void> =>
  document.hasFocus()
    ? Promise.resolve()
    : new Promise((resolve) => {
        const done = () => {
          window.clearTimeout(timer);
          window.removeEventListener("focus", done);
          resolve();
        };
        const timer = window.setTimeout(done, 400);
        window.addEventListener("focus", done);
      });

export const installContextMenus = (): void => {
  const api = window.electronAPI?.contextMenu;
  if (state.installed || !api) return;
  state.installed = true;
  window.addEventListener(
    "pointerdown",
    (event) => {
      state.selectedBeforePress =
        event.button === 2 ? (window.getSelection()?.toString() ?? "") : null;
    },
    true,
  );
  window.addEventListener(
    "contextmenu",
    (event) => {
      const target = elementOf(event.target);
      if (!target) return;
      state.capture = {
        event,
        target,
        at: performance.now(),
        contributions: [],
        consumed: false,
      };
    },
    true,
  );
  api.onCollect((request) => {
    void state.collect(request);
  });
  api.onSelect(({ requestId, itemId }) => {
    if (requestId !== state.activeRequestId) return;
    const run = state.handlers.get(itemId);
    if (!run) return;
    void waitForFocus()
      .then(run)
      .catch((error: unknown) => {
        console.warn("[context-menu] action failed:", error);
      });
  });
};
