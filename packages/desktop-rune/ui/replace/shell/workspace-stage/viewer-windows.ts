import { flushSync } from "react-dom";
import { detachedWindows } from "../../features/workspace-display/detached-windows";
import { connectViewerWindows, fileViewer, type FileViewerRect } from "@/features/workspace-display/file-viewer-store";
import { displayTabs } from "@/features/workspace-display/tab-store";
import { viewAtom } from "@/platform/view-state/view-state";
import type { ViewerWindowTicket } from "@stella/contracts/desktop/viewer-window";

const POP_OUT_OFFSET = 24;

type RememberedViewer = { fileId: string; bounds: FileViewerRect };

const rememberedViewers = viewAtom<RememberedViewer[]>("workspace.detachedViewers", []);

const viewerWindowApi = () => window.electronAPI?.viewerWindow ?? null;

const fullWindowId = () => stella.host?.windows.snapshot().find((w) => w.mode === "full")?.id ?? null;

export const canDetachViewer = (): boolean => viewerWindowApi() !== null && Boolean(stella.host);

let viewerBackground = "#101016";

/** The colour a new viewer window paints before its first frame (the viewer's own background). */
export const setViewerWindowBackground = (color: string): void => {
  viewerBackground = color.slice(0, 7);
};

const remember = (): void => {
  const windows = stella.host?.windows.snapshot() ?? [];
  rememberedViewers.set(
    fileViewer.getSnapshot().detached.flatMap(({ fileId, name }) => {
      const open = windows.find((w) => w.frameName === name);
      return open ? [{ fileId, bounds: { x: open.bounds.x, y: open.bounds.y, width: open.bounds.width, height: open.bounds.height } }] : [];
    }),
  );
};

let listening = false;
const listen = (): void => {
  const api = viewerWindowApi();
  if (listening || !api) return;
  listening = true;
  api.onClosed(({ name }) => {
    if (!detachedWindows.has(name)) return;
    detachedWindows.delete(name);
    fileViewer.closeDetached(name);
  });
  stella.host?.windows.subscribe(() => {
    if (detachedWindows.size > 0) remember();
  });
};

export const prepareViewerWindow = async (): Promise<ViewerWindowTicket | null> => {
  listen();
  return (await viewerWindowApi()?.prepare({ background: viewerBackground }).catch(() => null)) ?? null;
};

connectViewerWindows({
  close: (name) => {
    if (!detachedWindows.has(name)) return;
    detachedWindows.delete(name);
    if (detachedWindows.size === 0) rememberedViewers.set([]);
    viewerWindowApi()?.act({ name, action: "close" });
  },
  focus: (name) => viewerWindowApi()?.act({ name, action: "focus" }),
});

export const openViewerWindow = (ticket: ViewerWindowTicket, fileId: string, bounds: FileViewerRect): boolean => {
  const opener = fullWindowId();
  if (!opener) return false;
  const { x, y, width, height } = bounds;
  const features = `popup,left=${Math.round(x)},top=${Math.round(y)},width=${Math.round(width)},height=${Math.round(height)}`;
  const hostId = stella.host?.open(opener, "about:blank", ticket.name, features);
  if (!hostId) return false;
  detachedWindows.set(ticket.name, { window, hostId });
  flushSync(() => fileViewer.detach({ name: ticket.name, fileId }));
  viewerWindowApi()?.act({ name: ticket.name, action: "show" });
  remember();
  return true;
};

export const moveViewerWindow = (name: string, x: number, y: number): void => {
  viewerWindowApi()?.move({ name, x, y });
};

export const focusViewerWindow = (name: string): void => {
  viewerWindowApi()?.act({ name, action: "focus" });
};

/** After a relaunch, puts detached viewers back. */
export const reopenViewerWindows = async (): Promise<void> => {
  if (!canDetachViewer() || detachedWindows.size > 0) return;
  for (const { fileId, bounds } of rememberedViewers.get()) {
    const known = displayTabs.getTabListSnapshot().tabs.some((tab) => tab.id === fileId);
    if (!known || fileViewer.surfaceOf(fileId)) continue;
    const ticket = await prepareViewerWindow();
    if (ticket) openViewerWindow(ticket, fileId, bounds);
  }
};

/** The main window's top-left on screen. */
export const mainWindowOrigin = (): { x: number; y: number } => {
  const full = stella.host?.windows.snapshot().find((w) => w.mode === "full");
  return { x: full?.bounds.x ?? 0, y: full?.bounds.y ?? 0 };
};

/** Detaches without a drag: beside where the viewer is now. */
export const popOutViewer = async (fileId: string, rect: FileViewerRect): Promise<void> => {
  const ticket = await prepareViewerWindow();
  if (!ticket || fileViewer.surfaceOf(fileId) !== "docked") return;
  const origin = mainWindowOrigin();
  const opened = openViewerWindow(ticket, fileId, { ...rect, x: origin.x + rect.x + POP_OUT_OFFSET, y: origin.y + rect.y + POP_OUT_OFFSET });
  if (opened) focusViewerWindow(ticket.name);
};
