import {
  normalizeDisplayPayload,
  type DisplayTabPayload,
} from "@stella/contracts/desktop/display-payload";
import { openDisplayPayloadTab } from "@/features/workspace-display/open-payload";
import { backendClient } from "@/platform/backend/backend-client";
import {
  canvasShareBaseUrl,
  isCanvasShareUrl,
  parseCanvasShareSlug,
} from "@/shared/lib/canvas-share";

export const isRendererCanvasShareUrl = (url: string): boolean =>
  isCanvasShareUrl(url, canvasShareBaseUrl());

const ownerViewUrl = async (url: string): Promise<string> => {
  const slug = parseCanvasShareSlug(url, canvasShareBaseUrl());
  if (!slug) return url;
  try {
    return (await backendClient.call("shares.viewLink", { slug })).url;
  } catch {
    return url;
  }
};

const openInSystemBrowser = (url: string): void => {
  if (window.electronAPI?.system.openExternal) {
    window.electronAPI.system.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

/**
 * In a browser the tab has to open inside the click, before the backend
 * answers, or it is blocked as a popup; it is pointed at the view URL after.
 */
const openPendingBrowserTab = (): ((url: string) => void) => {
  const pending = window.open("about:blank", "_blank");
  if (!pending) return (url) => openInSystemBrowser(url);
  pending.opener = null;
  return (url) => {
    pending.location.replace(url);
  };
};

const renderShared = async (
  url: string,
): Promise<{ handled: boolean; viewUrl: string }> => {
  if (!isRendererCanvasShareUrl(url)) return { handled: false, viewUrl: url };
  const viewUrl = await ownerViewUrl(url);
  const openSharedCanvas = window.electronAPI?.display?.openSharedCanvas;
  if (typeof openSharedCanvas !== "function") return { handled: false, viewUrl };
  let raw: unknown;
  try {
    raw = await openSharedCanvas({ url: viewUrl });
  } catch {
    return { handled: false, viewUrl };
  }
  const payload: DisplayTabPayload | null = normalizeDisplayPayload(raw);
  if (!payload || payload.kind !== "canvas-html") return { handled: false, viewUrl };
  openDisplayPayloadTab(payload, { activate: true });
  return { handled: true, viewUrl };
};

export const maybeHandleCanvasShareUrl = (url: string): boolean => {
  if (!isRendererCanvasShareUrl(url)) return false;
  const openFallback = window.electronAPI
    ? openInSystemBrowser
    : openPendingBrowserTab();
  void renderShared(url).then(({ handled, viewUrl }) => {
    if (!handled) openFallback(viewUrl);
  });
  return true;
};
