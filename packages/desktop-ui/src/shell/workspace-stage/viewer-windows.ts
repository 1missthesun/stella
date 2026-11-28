import { flushSync } from "react-dom";
import { detachedWindows } from "@/features/workspace-display/detached-windows";
import {
  connectViewerWindows,
  fileViewer,
  type FileViewerRect,
} from "@/features/workspace-display/file-viewer-store";
import { displayTabs } from "@/features/workspace-display/tab-store";
import { flushViewState, viewAtom } from "@/platform/view-state/view-state";
import { trackContextMenus } from "@/platform/context-menu/context-menu";
import type { ViewerWindowTicket } from "@stella/contracts/desktop/viewer-window";

const POP_OUT_OFFSET = 24;

type RememberedViewer = { fileId: string; bounds: FileViewerRect };

const rememberedViewers = viewAtom<RememberedViewer[]>(
  "workspace.detachedViewers",
  [],
);

const rememberAtLeave = (): void => {
  rememberedViewers.set(
    fileViewer.getSnapshot().detached.flatMap(({ fileId, name }) => {
      const open = detachedWindows.get(name)?.window;
      if (!open) return [];
      const bounds = {
        x: open.screenX,
        y: open.screenY,
        width: open.innerWidth,
        height: open.innerHeight,
      };
      return [{ fileId, bounds }];
    }),
  );
  flushViewState();
};

const viewerWindowApi = () => window.electronAPI?.viewerWindow ?? null;

export const canDetachViewer = (): boolean => viewerWindowApi() !== null;

const toHex = (color: string): string => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((part) => part!.toString(16).padStart(2, "0")).join("")}`;
};

const surfaceColor = (): string => {
  const frame = document.querySelector(".file-viewer") ?? document.body;
  return toHex(getComputedStyle(frame).backgroundColor);
};

export const prepareViewerWindow =
  async (): Promise<ViewerWindowTicket | null> => {
    listenForCloses();
    return (
      (await viewerWindowApi()
        ?.prepare({ background: surfaceColor() })
        .catch(() => null)) ?? null
    );
  };

const copyAttributes = (from: Element, to: Element): void => {
  for (const name of to.getAttributeNames()) {
    if (!from.hasAttribute(name)) to.removeAttribute(name);
  }
  for (const { name, value } of from.attributes) {
    if (to.getAttribute(name) !== value) to.setAttribute(name, value);
  }
};

const STYLES = "style, link[rel='stylesheet']";

const addFont = (target: Document, face: FontFace): void => {
  try {
    target.fonts.add(face);
  } catch {
    // A face from an @font-face rule: the window has it from the copied styles.
  }
};

const SHARES_FONTS = Symbol.for("stella.viewerWindows.sharesFonts");

/**
 * Fonts added from script (pdf.js loads each PDF's embedded fonts this way)
 * join only Stella's own document, while a canvas moved into a viewer window
 * looks its fonts up in that window's document. Each one joins every open
 * viewer window as it is added, so text drawn there never falls back to boxes.
 */
const shareScriptFonts = (): void => {
  const fonts = document.fonts as FontFaceSet & { [SHARES_FONTS]?: true };
  if (fonts[SHARES_FONTS]) return;
  fonts[SHARES_FONTS] = true;
  const add = fonts.add.bind(fonts);
  const remove = fonts.delete.bind(fonts);
  fonts.add = (face) => {
    add(face);
    for (const { window: open } of detachedWindows.values()) {
      addFont(open.document, face);
    }
    return fonts;
  };
  fonts.delete = (face) => {
    for (const { window: open } of detachedWindows.values()) {
      open.document.fonts.delete(face);
    }
    return remove(face);
  };
};

const mirrorFonts = (target: Document): void => {
  shareScriptFonts();
  for (const face of document.fonts) addFont(target, face);
};

const mirrorAppearance = (target: Document): (() => void) => {
  const copies = new Map<Element, Element>();
  const syncStyles = () => {
    const sources = [...document.head.querySelectorAll(STYLES)];
    const present = new Set<Element>(sources);
    for (const [source, copy] of copies) {
      if (present.has(source)) continue;
      copy.remove();
      copies.delete(source);
    }
    for (const source of sources) {
      const existing = copies.get(source);
      if (existing) {
        if (existing.textContent !== source.textContent) {
          existing.textContent = source.textContent;
        }
        continue;
      }
      const copy = target.importNode(source, true);
      copies.set(source, copy);
      target.head.appendChild(copy);
    }
  };
  const syncRoot = () => {
    copyAttributes(document.documentElement, target.documentElement);
    target.documentElement.dataset.stellaWindow = "viewer";
  };
  syncRoot();
  syncStyles();
  mirrorFonts(target);
  const root = new MutationObserver(syncRoot);
  root.observe(document.documentElement, { attributes: true });
  const styles = new MutationObserver(syncStyles);
  styles.observe(document.head, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return () => {
    root.disconnect();
    styles.disconnect();
  };
};

const forget = (name: string): void => {
  detachedWindows.get(name)?.stopMirroring();
  detachedWindows.delete(name);
  if (detachedWindows.size > 0) return;
  window.removeEventListener("pagehide", rememberAtLeave);
  rememberedViewers.set([]);
};

let listening = false;
const listenForCloses = (): void => {
  const api = viewerWindowApi();
  if (listening || !api) return;
  listening = true;
  api.onClosed(({ name }) => {
    if (!detachedWindows.has(name)) return;
    forget(name);
    fileViewer.closeDetached(name);
  });
};

// @reloadable the newer handlers replace the registered ones
connectViewerWindows({
  close: (name) => {
    if (!detachedWindows.has(name)) return;
    forget(name);
    viewerWindowApi()?.act({ name, action: "close" });
  },
  focus: (name) => viewerWindowApi()?.act({ name, action: "focus" }),
});

export const openViewerWindow = (
  ticket: ViewerWindowTicket,
  fileId: string,
  bounds: FileViewerRect,
): boolean => {
  const { x, y, width, height } = bounds;
  const opened = window.open(
    "about:blank",
    ticket.name,
    `popup,left=${Math.round(x)},top=${Math.round(y)},width=${Math.round(width)},height=${Math.round(height)}`,
  );
  if (!opened) return false;
  const { document: target } = opened;
  const root = target.createElement("div");
  root.className = "app viewer-window";
  target.body.appendChild(root);
  const stopMirroring = mirrorAppearance(target);
  trackContextMenus(opened);
  if (detachedWindows.size === 0) window.addEventListener("pagehide", rememberAtLeave);
  detachedWindows.set(ticket.name, { window: opened, root, stopMirroring });
  flushSync(() =>
    fileViewer.detach({ name: ticket.name, fileId }),
  );
  viewerWindowApi()?.act({ name: ticket.name, action: "show" });
  return true;
};

export const moveViewerWindow = (name: string, x: number, y: number): void => {
  viewerWindowApi()?.move({ name, x, y });
};

export const focusViewerWindow = (name: string): void => {
  viewerWindowApi()?.act({ name, action: "focus" });
};

/** After a reload, which closes them, puts detached viewers back. */
export const reopenViewerWindows = async (): Promise<void> => {
  if (!canDetachViewer() || detachedWindows.size > 0) return;
  for (const { fileId, bounds } of rememberedViewers.get()) {
    const known = displayTabs
      .getTabListSnapshot()
      .tabs.some((tab) => tab.id === fileId);
    if (!known || fileViewer.surfaceOf(fileId)) continue;
    const ticket = await prepareViewerWindow();
    if (ticket) openViewerWindow(ticket, fileId, bounds);
  }
};

/** Detaches without a drag: beside where the viewer is now. */
export const popOutViewer = async (
  fileId: string,
  rect: FileViewerRect,
): Promise<void> => {
  const ticket = await prepareViewerWindow();
  if (!ticket || fileViewer.surfaceOf(fileId) !== "docked") return;
  const opened = openViewerWindow(ticket, fileId, {
    ...rect,
    x: window.screenX + rect.x + POP_OUT_OFFSET,
    y: window.screenY + rect.y + POP_OUT_OFFSET,
  });
  if (opened) focusViewerWindow(ticket.name);
};
