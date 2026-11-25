import { flushSync } from "react-dom";
import { fileViewer, type FileViewerRect } from "@/features/workspace-display/file-viewer-store";
import { clampFloatRect, getGeometry } from "../../replace/shell/workspace-stage/viewer-geometry";
import { focusViewerWindow, mainWindowOrigin, moveViewerWindow, openViewerWindow, prepareViewerWindow } from "../../replace/shell/workspace-stage/viewer-windows";
import type { ViewerWindowTicket } from "@stella/contracts/desktop/viewer-window";

const TEAR_DISTANCE = 96;
const REJOIN_DISTANCE = 28;
const POINTER_OUTSIDE = 20;
const POINTER_INSIDE = 28;
const STRETCH_LIMIT = 46;
const LIFT = 0.025;

type Point = { x: number; y: number };

/** Where the floating frame draws while it is held: its rect, how far it is pulled past the edge, and its lift. */
export type HeldViewer = { rect: FileViewerRect; dx: number; dy: number; scale: number; grab: Point; torn: boolean };

/** Follows the pull closely at first, then ever less, up to a hard limit. */
const stretch = (pull: number): number => Math.sign(pull) * STRETCH_LIMIT * (1 - Math.exp(-Math.abs(pull) / (STRETCH_LIMIT * 1.7)));

const pastWindowEdge = (rect: FileViewerRect, pointer: Point): number => {
  const { innerWidth, innerHeight } = window;
  const frame = Math.max(-rect.x, rect.x + rect.width - innerWidth, rect.y + rect.height - innerHeight, -rect.y * 2);
  const outside = Math.max(-pointer.x, pointer.x - innerWidth, -pointer.y, pointer.y - innerHeight);
  return Math.max(frame, (outside / POINTER_OUTSIDE) * TEAR_DISTANCE);
};

const wellInside = (pointer: Point): boolean =>
  pointer.x > POINTER_INSIDE && pointer.y > POINTER_INSIDE && pointer.x < window.innerWidth - POINTER_INSIDE && pointer.y < window.innerHeight - POINTER_INSIDE;

let tearing: string | null = null;
const tearListeners = new Set<() => void>();

/** The item a drag is carrying outside the window, whose frame must stay mounted to keep the gesture. */
export const viewerTear = {
  get: () => tearing,
  subscribe(listener: () => void) {
    tearListeners.add(listener);
    return () => {
      tearListeners.delete(listener);
    };
  },
};

const setTearing = (fileId: string | null) => {
  if (tearing === fileId) return;
  tearing = fileId;
  for (const listener of tearListeners) listener();
};

/**
 * One header drag of the floating viewer: it moves inside the window, stretches against the edge,
 * tears off into its own window past it (following the pointer), and rejoins when brought back.
 */
export function startViewerDrag(fileId: string, start: FileViewerRect, at: Point, detachable: boolean, redraw: (held: HeldViewer) => void) {
  const grab: Point = { x: at.x - start.x, y: at.y - start.y };
  let pointer = at;
  let base = start;
  let preparing = false;
  let ended = false;
  let ready: ViewerWindowTicket | null = null;
  let torn: string | null = null;

  const screen = (): Point => {
    const origin = mainWindowOrigin();
    return { x: origin.x + pointer.x, y: origin.y + pointer.y };
  };
  const wanted = (): FileViewerRect => ({ ...base, x: pointer.x - grab.x, y: pointer.y - grab.y });

  const prepare = () => {
    if (preparing) return;
    preparing = true;
    void prepareViewerWindow().then((ticket) => {
      ready = ticket;
      if (!ended) redraw(draw());
    });
  };

  const tearOff = (): boolean => {
    if (!ready) return false;
    const s = screen();
    setTearing(fileId);
    const opened = openViewerWindow(ready, fileId, { ...base, x: s.x - grab.x, y: s.y - grab.y });
    const { name, follows } = ready;
    ready = null;
    preparing = false;
    if (!opened) {
      setTearing(null);
      return false;
    }
    torn = name;
    if (!follows) {
      ended = true;
      setTearing(null);
      focusViewerWindow(name);
    }
    return true;
  };

  const rejoin = () => {
    const name = torn!;
    torn = null;
    base = clampFloatRect(wanted(), getGeometry());
    flushSync(() => fileViewer.dock(name, base));
  };

  const draw = (): HeldViewer => {
    if (torn) {
      if (pastWindowEdge(wanted(), pointer) < REJOIN_DISTANCE && wellInside(pointer)) {
        rejoin();
      } else {
        const s = screen();
        moveViewerWindow(torn, s.x - grab.x, s.y - grab.y);
        return { rect: base, dx: 0, dy: 0, scale: 1, grab, torn: true };
      }
    }
    const raw = wanted();
    const pulled = Math.max(0, pastWindowEdge(raw, pointer)) / TEAR_DISTANCE;
    if (pulled > 0 && detachable) {
      prepare();
      if (pulled >= 1 && tearOff()) return { rect: base, dx: 0, dy: 0, scale: 1, grab, torn: true };
    }
    const held = clampFloatRect(raw, getGeometry());
    return {
      rect: base,
      dx: held.x + stretch(raw.x - held.x) - base.x,
      dy: held.y + stretch(raw.y - held.y) - base.y,
      scale: detachable ? 1 - LIFT * Math.min(1, pulled) : 1,
      grab,
      torn: false,
    };
  };

  return {
    move(next: Point): HeldViewer {
      pointer = next;
      return draw();
    },
    end(): void {
      ended = true;
      setTearing(null);
      if (torn) focusViewerWindow(torn);
      else fileViewer.setRect(clampFloatRect(wanted(), getGeometry()));
    },
  };
}
