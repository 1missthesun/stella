// Rune's OffscreenTabs (master: services/in-app-browser/offscreen-tabs.ts). Every in-app browser
// tab is a page in the headless Chromium, which draws without a window, so there is no host window
// and no mirror view: an offscreen tab is sized like the panel's page, and the panel shows the tab's
// own view, whose frames the UI streams onto the window. Sizing goes to the page's viewport, not
// the view's bounds, which say only where the panel shows it.

import type { Rectangle, WebContentsView } from "electron";

type ManagedTab = { view: WebContentsView };

const sizePage = (tab: ManagedTab, size: { width: number; height: number }) =>
  (tab.view.webContents as unknown as { setPageSize(width: number, height: number): void }).setPageSize(size.width, size.height);

const DEFAULT_SIZE = { width: 1280, height: 720 };

export type OffscreenTabsOptions = {
  mirrorPreloadPath: string;
  getPageBounds: () => Rectangle | undefined;
};

export class OffscreenTabs {
  private readonly mounted = new Set<ManagedTab>();
  private shown: ManagedTab | null = null;

  constructor(private readonly options: OffscreenTabsOptions) {}

  webPreferences() {
    return { offscreen: { deviceScaleFactor: 1 } } as const;
  }

  adopt(tab: ManagedTab) {
    if (this.mounted.has(tab) || tab.view.webContents.isDestroyed()) return;
    this.mounted.add(tab);
    sizePage(tab, this.size());
  }

  release(tab: ManagedTab) {
    if (this.shown === tab) this.shown = null;
    this.mounted.delete(tab);
  }

  resize() {
    const size = this.size();
    for (const tab of this.mounted) {
      if (!tab.view.webContents.isDestroyed()) sizePage(tab, size);
    }
  }

  isMirroring(tab: ManagedTab) {
    return this.shown === tab;
  }

  pausePainting(_tab: ManagedTab): () => void {
    return () => {};
  }

  mirrorFor(tab: ManagedTab): WebContentsView {
    this.shown = tab;
    return tab.view;
  }

  unbindMirror() {
    this.shown = null;
  }

  dispose() {
    this.shown = null;
    this.mounted.clear();
  }

  private size() {
    const bounds = this.options.getPageBounds();
    return {
      width: Math.max(1, Math.round(bounds?.width ?? DEFAULT_SIZE.width)),
      height: Math.max(1, Math.round(bounds?.height ?? DEFAULT_SIZE.height)),
    };
  }
}
