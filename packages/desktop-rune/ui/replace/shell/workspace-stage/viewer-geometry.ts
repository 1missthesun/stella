import { useEffect, useSyncExternalStore } from "react";
import type { FileViewerRect } from "@/features/workspace-display/file-viewer-store";
import { SHELL_TOPBAR_HEIGHT } from "../../../shell/metrics";

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

/** The shown composer's window rect, with `top` raised to whatever sits above it in the composer area. */
export type ComposerArea = { top: number; left: number; width: number };

let composerArea: ComposerArea | null = null;

const measureGeometry = (): Geometry => {
  const viewportHeight = window.innerHeight;
  return {
    topbar: SHELL_TOPBAR_HEIGHT,
    viewportWidth: window.innerWidth,
    viewportHeight,
    floor: composerArea ? composerArea.top - STAGE_GAP_ABOVE_COMPOSER : viewportHeight - STAGE_BOTTOM_WITHOUT_COMPOSER,
    composer: composerArea ? { left: composerArea.left, width: composerArea.width } : null,
  };
};

const sameGeometry = (a: Geometry, b: Geometry) =>
  a.topbar === b.topbar &&
  a.viewportWidth === b.viewportWidth &&
  a.viewportHeight === b.viewportHeight &&
  Math.round(a.floor) === Math.round(b.floor) &&
  Math.round(a.composer?.left ?? -1) === Math.round(b.composer?.left ?? -1) &&
  Math.round(a.composer?.width ?? -1) === Math.round(b.composer?.width ?? -1);

let geometry: Geometry | null = null;
const listeners = new Set<() => void>();
const refreshGeometry = () => {
  const next = measureGeometry();
  if (geometry && sameGeometry(geometry, next)) return;
  geometry = next;
  for (const listener of listeners) listener();
};
const subscribeGeometry = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getGeometry = (): Geometry => {
  if (!geometry) refreshGeometry();
  return geometry!;
};

/** The chat column reports where its composer area is, or `null` when no composer shows. */
export const reportComposerArea = (area: ComposerArea | null): void => {
  const same =
    area === composerArea ||
    (area && composerArea && Math.round(area.top) === Math.round(composerArea.top) && Math.round(area.left) === Math.round(composerArea.left) && Math.round(area.width) === Math.round(composerArea.width));
  if (same) return;
  composerArea = area;
  refreshGeometry();
};

export const useGeometryTracking = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    refreshGeometry();
    window.addEventListener("resize", refreshGeometry);
    return () => window.removeEventListener("resize", refreshGeometry);
  }, [active]);
};

export const useGeometry = (): Geometry => useSyncExternalStore(subscribeGeometry, getGeometry, getGeometry);

/** `--workspace-stage-bottom`: the gap under the stage, down to the window's bottom edge. */
export const stageBottom = (geo: Geometry): number => Math.max(0, Math.round(geo.viewportHeight - geo.floor));

export const defaultFloatRect = (geo: Geometry): FileViewerRect => {
  const available = geo.floor - geo.topbar - FLOAT_MARGIN * 2;
  const width = Math.min(760, Math.max(FLOAT_MIN_WIDTH, geo.composer?.width ?? 680), geo.viewportWidth - FLOAT_MARGIN * 2);
  const height = Math.max(Math.min(FLOAT_MIN_HEIGHT, available), Math.min(500, available));
  const centre = geo.composer ? geo.composer.left + geo.composer.width / 2 : geo.viewportWidth / 2;
  return {
    x: Math.round(centre - width / 2),
    y: Math.round(geo.topbar + FLOAT_TOP_GAP),
    width: Math.round(width),
    height: Math.round(height),
  };
};

export const clampFloatRect = (rect: FileViewerRect, geo: Geometry): FileViewerRect => {
  const minTop = geo.topbar + 2;
  const maxBottom = geo.floor;
  const maxWidth = geo.viewportWidth - FLOAT_MARGIN * 2;
  const maxHeight = Math.max(120, maxBottom - minTop);
  const width = Math.min(Math.max(rect.width, FLOAT_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(rect.height, Math.min(FLOAT_MIN_HEIGHT, maxHeight)), maxHeight);
  const x = Math.min(Math.max(rect.x, FLOAT_MARGIN), geo.viewportWidth - FLOAT_MARGIN - width);
  const y = Math.min(Math.max(rect.y, minTop), maxBottom - height);
  return { x: Math.round(x), y: Math.round(Math.max(minTop, y)), width: Math.round(width), height: Math.round(height) };
};
