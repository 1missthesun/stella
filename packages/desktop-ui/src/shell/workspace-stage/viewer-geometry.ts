import { useLayoutEffect, useSyncExternalStore } from "react";
import type { FileViewerRect } from "@/features/workspace-display/file-viewer-store";

const STAGE_GAP_ABOVE_COMPOSER = 12;
const STAGE_BOTTOM_WITHOUT_COMPOSER = 14;
const FLOAT_MARGIN = 8;
export const FLOAT_MIN_WIDTH = 320;
export const FLOAT_MIN_HEIGHT = 220;
const FLOAT_TOP_GAP = 10;

export type Geometry = {
  topbar: number;
  viewportWidth: number;
  viewportHeight: number;
  floor: number;
  composer: { left: number; width: number } | null;
};

const readTopbarHeight = (): number => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--shell-topbar-height",
  );
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 38;
};

const findComposerShell = (): HTMLElement | null => {
  const surface = document.querySelector(".persistent-chat-surface--active");
  if (!surface) return null;
  let best: { el: HTMLElement; bottom: number } | null = null;
  for (const el of surface.querySelectorAll<HTMLElement>(".composer-shell")) {
    if (el.closest("[inert]")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (!best || rect.bottom > best.bottom) best = { el, bottom: rect.bottom };
  }
  return best?.el ?? null;
};

const topOfComposerArea = (shell: HTMLElement, top: number): number => {
  let el = shell.closest(".composer-wrap")?.previousElementSibling ?? null;
  while (el && !el.classList.contains("chat-viewport-region")) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) top = Math.min(top, rect.top);
    el = el.previousElementSibling;
  }
  return top;
};

const measureGeometry = (): Geometry => {
  const shell = findComposerShell();
  const composer = shell?.getBoundingClientRect() ?? null;
  const viewportHeight = window.innerHeight;
  return {
    topbar: readTopbarHeight(),
    viewportWidth: window.innerWidth,
    viewportHeight,
    floor:
      shell && composer
        ? topOfComposerArea(shell, composer.top) - STAGE_GAP_ABOVE_COMPOSER
        : viewportHeight - STAGE_BOTTOM_WITHOUT_COMPOSER,
    composer: composer ? { left: composer.left, width: composer.width } : null,
  };
};

const sameGeometry = (a: Geometry, b: Geometry) =>
  a.topbar === b.topbar &&
  a.viewportWidth === b.viewportWidth &&
  a.viewportHeight === b.viewportHeight &&
  Math.round(a.floor) === Math.round(b.floor) &&
  Math.round(a.composer?.left ?? -1) === Math.round(b.composer?.left ?? -1) &&
  Math.round(a.composer?.width ?? -1) === Math.round(b.composer?.width ?? -1);

// @reloadable the geometry is measured again on first use
let geometry: Geometry | null = null;
const geometryListeners = new Set<() => void>();
const refreshGeometry = () => {
  const next = measureGeometry();
  if (geometry && sameGeometry(geometry, next)) return;
  geometry = next;
  document.documentElement.style.setProperty(
    "--workspace-stage-bottom",
    `${Math.max(0, Math.round(next.viewportHeight - next.floor))}px`,
  );
  for (const listener of geometryListeners) listener();
};
const subscribeGeometry = (listener: () => void) => {
  geometryListeners.add(listener);
  return () => {
    geometryListeners.delete(listener);
  };
};
export const getGeometry = (): Geometry => {
  if (!geometry) refreshGeometry();
  return geometry!;
};

export const useGeometryTracking = (active: boolean) => {
  useLayoutEffect(() => {
    if (!active) return;
    refreshGeometry();
    const interval = window.setInterval(refreshGeometry, 250);
    window.addEventListener("resize", refreshGeometry);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", refreshGeometry);
    };
  }, [active]);
};

export const useGeometry = (): Geometry =>
  useSyncExternalStore(subscribeGeometry, getGeometry, getGeometry);

export const defaultFloatRect = (geo: Geometry): FileViewerRect => {
  const available = geo.floor - geo.topbar - FLOAT_MARGIN * 2;
  const width = Math.min(
    760,
    Math.max(FLOAT_MIN_WIDTH, geo.composer?.width ?? 680),
    geo.viewportWidth - FLOAT_MARGIN * 2,
  );
  const height = Math.max(
    Math.min(FLOAT_MIN_HEIGHT, available),
    Math.min(500, available),
  );
  const centre = geo.composer
    ? geo.composer.left + geo.composer.width / 2
    : geo.viewportWidth / 2;
  return {
    x: Math.round(centre - width / 2),
    y: Math.round(geo.topbar + FLOAT_TOP_GAP),
    width: Math.round(width),
    height: Math.round(height),
  };
};

export const clampFloatRect = (
  rect: FileViewerRect,
  geo: Geometry,
): FileViewerRect => {
  const minTop = geo.topbar + 2;
  const maxBottom = geo.floor;
  const maxWidth = geo.viewportWidth - FLOAT_MARGIN * 2;
  const maxHeight = Math.max(120, maxBottom - minTop);
  const width = Math.min(Math.max(rect.width, FLOAT_MIN_WIDTH), maxWidth);
  const height = Math.min(
    Math.max(rect.height, Math.min(FLOAT_MIN_HEIGHT, maxHeight)),
    maxHeight,
  );
  const x = Math.min(
    Math.max(rect.x, FLOAT_MARGIN),
    geo.viewportWidth - FLOAT_MARGIN - width,
  );
  const y = Math.min(Math.max(rect.y, minTop), maxBottom - height);
  return {
    x: Math.round(x),
    y: Math.round(Math.max(minTop, y)),
    width: Math.round(width),
    height: Math.round(height),
  };
};
