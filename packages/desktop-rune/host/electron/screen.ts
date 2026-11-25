// screen: Electron's API is synchronous, the engine's is not, so displays and the cursor are
// cached and refreshed from the engine (at boot, on display events, and after each read).

import { EventEmitter } from "node:events";
import { engine, onEngine, type EngineDisplay } from "./engine";

type Point = { x: number; y: number };

const fallbackDisplay = (): EngineDisplay => {
  const width = Number(process.env.STELLA_RUNE_SCREEN_W ?? 1920);
  const height = Number(process.env.STELLA_RUNE_SCREEN_H ?? 1080);
  return { id: 1, label: "Display", bounds: { x: 0, y: 0, width, height }, workArea: { x: 0, y: 0, width, height }, scaleFactor: 1 };
};

const complete = (d: EngineDisplay) => ({
  rotation: 0,
  internal: false,
  monochrome: false,
  colorDepth: 24,
  colorSpace: "srgb",
  depthPerComponent: 8,
  displayFrequency: 60,
  accelerometerSupport: "unknown" as const,
  touchSupport: "unknown" as const,
  detected: true,
  label: "",
  ...d,
  size: { width: d.bounds.width, height: d.bounds.height },
  workAreaSize: { width: d.workArea.width, height: d.workArea.height },
});

export type Display = ReturnType<typeof complete>;

let displays: Display[] = [complete(fallbackDisplay())];
let cursor: Point = { x: 0, y: 0 };
let refreshing: Promise<void> | null = null;

const sameDisplays = (a: Display[], b: Display[]) => JSON.stringify(a) === JSON.stringify(b);

class Screen extends EventEmitter {
  constructor() { super(); this.setMaxListeners(0); }
  getPrimaryDisplay(): Display { void refreshDisplays(); return displays[0]!; }
  getAllDisplays(): Display[] { void refreshDisplays(); return [...displays]; }
  getCursorScreenPoint(): Point { void refreshCursor(); return { ...cursor }; }
  getDisplayNearestPoint(point: Point): Display {
    let best = displays[0]!;
    let bestDistance = Infinity;
    for (const d of displays) {
      const { x, y, width, height } = d.bounds;
      const dx = Math.max(x - point.x, 0, point.x - (x + width));
      const dy = Math.max(y - point.y, 0, point.y - (y + height));
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) { best = d; bestDistance = distance; }
    }
    return best;
  }
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Display {
    let best = displays[0]!;
    let bestArea = -1;
    for (const d of displays) {
      const w = Math.min(rect.x + rect.width, d.bounds.x + d.bounds.width) - Math.max(rect.x, d.bounds.x);
      const h = Math.min(rect.y + rect.height, d.bounds.y + d.bounds.height) - Math.max(rect.y, d.bounds.y);
      const area = Math.max(0, w) * Math.max(0, h);
      if (area > bestArea) { best = d; bestArea = area; }
    }
    return bestArea > 0 ? best : this.getDisplayNearestPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  }
  screenToDipPoint(point: Point): Point {
    const scale = this.getDisplayNearestPoint(point).scaleFactor || 1;
    return { x: point.x / scale, y: point.y / scale };
  }
  dipToScreenPoint(point: Point): Point {
    const scale = this.getDisplayNearestPoint(point).scaleFactor || 1;
    return { x: point.x * scale, y: point.y * scale };
  }
  screenToDipRect(_win: unknown, rect: { x: number; y: number; width: number; height: number }) {
    const s = this.getDisplayMatching(rect).scaleFactor || 1;
    return { x: rect.x / s, y: rect.y / s, width: rect.width / s, height: rect.height / s };
  }
  dipToScreenRect(_win: unknown, rect: { x: number; y: number; width: number; height: number }) {
    const s = this.getDisplayMatching(rect).scaleFactor || 1;
    return { x: rect.x * s, y: rect.y * s, width: rect.width * s, height: rect.height * s };
  }
}

export const screen = new Screen();

export function primaryDisplaySync(): Display {
  return displays[0]!;
}

export async function refreshDisplays(): Promise<void> {
  const e = engine();
  if (!e || refreshing) return refreshing ?? undefined;
  refreshing = (async () => {
    try {
      const next = (await e.screen.displays()).map(complete);
      if (next.length === 0 || sameDisplays(next, displays)) return;
      const before = new Map(displays.map((d) => [d.id, d]));
      const after = new Map(next.map((d) => [d.id, d]));
      displays = next;
      for (const d of next) {
        const old = before.get(d.id);
        if (!old) screen.emit("display-added", {}, d);
        else if (JSON.stringify(old) !== JSON.stringify(d)) screen.emit("display-metrics-changed", {}, d, ["bounds", "workArea", "scaleFactor"]);
      }
      for (const d of before.values()) if (!after.has(d.id)) screen.emit("display-removed", {}, d);
    } catch {
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

let cursorPending = false;
async function refreshCursor() {
  const e = engine();
  if (!e || cursorPending) return;
  cursorPending = true;
  try { cursor = await e.screen.cursorPoint(); } catch {} finally { cursorPending = false; }
}

/** Reads the cursor from the engine now (for callers that can wait). */
export async function cursorPoint(): Promise<Point> {
  await refreshCursor();
  return { ...cursor };
}

onEngine("display", () => { void refreshDisplays(); });
