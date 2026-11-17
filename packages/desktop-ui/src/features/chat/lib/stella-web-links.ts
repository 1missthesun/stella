import type { ElectronBrowserViewApi } from "@/shared/types/electron";
import { maybeHandleCanvasShareUrl } from "@/features/canvas-share/open-shared-canvas";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";
import { displayTabs } from "@/features/workspace-display/tab-store";

type WebLinkBrowserApi = Pick<
  ElectronBrowserViewApi,
  "createTab" | "getState" | "selectTab"
>;

type LinkClick = {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export const normalizedHttpUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
};

export const isUnmodifiedPrimaryClick = (event: LinkClick): boolean =>
  event.button === 0 &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey;

const revealBrowserSection = () => {
  const existing = sidebarSections
    .getSnapshot()
    .tabs.find((tab) => tab.kind === "browser");
  if (existing) {
    sidebarSections.activateTab(existing.id);
    displayTabs.setPanelOpen(true);
    return;
  }
  sidebarSections.openLocation("browser", null);
};

export const openUrlInStellaBrowser = async (
  value: string,
  api: WebLinkBrowserApi,
): Promise<boolean> => {
  const url = normalizedHttpUrl(value);
  if (!url) return false;

  revealBrowserSection();
  const state = await api.getState();
  const existing = state.tabs.find((tab) => tab.url === url);
  if (existing) {
    await api.selectTab({
      tabId: existing.id,
      ownerId: existing.ownerId,
      activate: true,
    });
  } else {
    await api.createTab({
      url,
      ownerId: state.visibleOwnerId,
      activate: true,
    });
  }
  return true;
};

/**
 * Opens a web page the way a link in a chat message does: a shared canvas in
 * Stella's viewer, any other page in Stella's browser on the desktop (the
 * system browser when that fails), a new tab on the web.
 */
export const openWebLink = (value: string): void => {
  const url = normalizedHttpUrl(value);
  if (!url || maybeHandleCanvasShareUrl(url)) return;
  const api = window.electronAPI?.browserView;
  if (!api) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  void openUrlInStellaBrowser(url, api).catch(() => {
    window.electronAPI?.system?.openExternal(url);
  });
};
