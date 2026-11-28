import { flushSync } from "react-dom";
import {
  fileViewer,
  type FileViewerRect,
} from "@/features/workspace-display/file-viewer-store";
import { clampFloatRect, getGeometry } from "./viewer-geometry";
import {
  focusViewerWindow,
  moveViewerWindow,
  openViewerWindow,
  prepareViewerWindow,
} from "./viewer-windows";
import type { ViewerWindowTicket } from "@stella/contracts/desktop/viewer-window";

const TEAR_DISTANCE = 96;
const REJOIN_DISTANCE = 28;
const POINTER_OUTSIDE = 20;
const POINTER_INSIDE = 28;
const STRETCH_LIMIT = 46;
const LIFT = 0.025;
const PAGE_REST_MS = 80;
const RESIZE_SLOP = 3;
const SETTLE_MS = 260;
const SETTLE_EASING = "cubic-bezier(0.2, 0.9, 0.25, 1)";

type Point = { x: number; y: number };

/** Follows the pull closely at first, then ever less, up to a hard limit. */
const stretch = (pull: number): number =>
  Math.sign(pull) *
  STRETCH_LIMIT *
  (1 - Math.exp(-Math.abs(pull) / (STRETCH_LIMIT * 1.7)));

const pastWindowEdge = (rect: FileViewerRect, pointer: Point): number => {
  const { innerWidth, innerHeight } = window;
  const frame = Math.max(
    -rect.x,
    rect.x + rect.width - innerWidth,
    rect.y + rect.height - innerHeight,
    -rect.y * 2,
  );
  const outside = Math.max(
    -pointer.x,
    pointer.x - innerWidth,
    -pointer.y,
    pointer.y - innerHeight,
  );
  return Math.max(frame, (outside / POINTER_OUTSIDE) * TEAR_DISTANCE);
};

const wellInside = (pointer: Point): boolean =>
  pointer.x > POINTER_INSIDE &&
  pointer.y > POINTER_INSIDE &&
  pointer.x < window.innerWidth - POINTER_INSIDE &&
  pointer.y < window.innerHeight - POINTER_INSIDE;

const dockedFrame = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(".file-viewer[data-surface='docked']");

const beginInteraction = (frame: HTMLElement): void => {
  for (const animation of frame.getAnimations()) animation.finish();
  frame.setAttribute("data-interacting", "true");
};

const perFrame = (step: () => void) => {
  let frame = 0;
  return {
    request: () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        step();
      });
    },
    flush: () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
      step();
    },
    stop: () => cancelAnimationFrame(frame),
  };
};

/**
 * Pointer moves for one gesture. The capture is on the root element because
 * the viewer's own frame leaves the page while it is torn off.
 */
const trackPointer = (
  pointerId: number,
  cursor: string,
  handlers: { move: (event: PointerEvent) => void; end: () => void },
): (() => void) => {
  const root = document.documentElement;
  root.setPointerCapture(pointerId);
  root.dataset.viewerGesture = "true";
  root.style.cursor = cursor;
  const stop = () => {
    root.removeEventListener("pointermove", handlers.move);
    root.removeEventListener("pointerup", end);
    root.removeEventListener("pointercancel", end);
    if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    delete root.dataset.viewerGesture;
    root.style.cursor = "";
  };
  const end = () => {
    stop();
    handlers.end();
  };
  root.addEventListener("pointermove", handlers.move);
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
  return stop;
};

export type ViewerGestureStart = {
  pointerId: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
};

export const dragViewer = (
  down: ViewerGestureStart,
  fileId: string,
  start: FileViewerRect,
  detachable: boolean,
): void => {
  const grab: Point = { x: down.clientX - start.x, y: down.clientY - start.y };
  let pointer: Point = { x: down.clientX, y: down.clientY };
  let screen: Point = { x: down.screenX, y: down.screenY };
  let base = start;
  let preparing = false;
  let ended = false;
  let ready: ViewerWindowTicket | null = null;
  let torn: string | null = null;

  const prepare = () => {
    if (preparing) return;
    preparing = true;
    void prepareViewerWindow().then((ticket) => {
      ready = ticket;
      if (!ended) steps.request();
    });
  };

  const wanted = (): FileViewerRect => ({
    ...base,
    x: pointer.x - grab.x,
    y: pointer.y - grab.y,
  });

  const tearOff = (): boolean => {
    if (!ready) return false;
    const opened = openViewerWindow(ready, fileId, {
      ...base,
      x: screen.x - grab.x,
      y: screen.y - grab.y,
    });
    const { name, follows } = ready;
    ready = null;
    preparing = false;
    if (!opened) return false;
    if (!follows) {
      ended = true;
      stopTracking();
      steps.stop();
      focusViewerWindow(name);
    }
    torn = name;
    return true;
  };

  const rejoin = () => {
    const name = torn!;
    torn = null;
    base = clampFloatRect(wanted(), getGeometry());
    flushSync(() => fileViewer.dock(name, base));
    const frame = dockedFrame();
    if (frame) beginInteraction(frame);
    draw();
  };

  const draw = () => {
    if (torn) {
      if (
        pastWindowEdge(wanted(), pointer) < REJOIN_DISTANCE &&
        wellInside(pointer)
      ) {
        rejoin();
        return;
      }
      moveViewerWindow(torn, screen.x - grab.x, screen.y - grab.y);
      return;
    }
    const raw = wanted();
    const pulled = Math.max(0, pastWindowEdge(raw, pointer)) / TEAR_DISTANCE;
    if (pulled > 0 && detachable) {
      prepare();
      if (pulled >= 1 && tearOff()) return;
    }
    const frame = dockedFrame();
    if (!frame) return;
    const held = clampFloatRect(raw, getGeometry());
    const x = held.x + stretch(raw.x - held.x) - base.x;
    const y = held.y + stretch(raw.y - held.y) - base.y;
    const lift = detachable ? 1 - LIFT * Math.min(1, pulled) : 1;
    frame.style.transformOrigin = `${grab.x}px ${grab.y}px`;
    frame.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${lift})`;
  };

  const steps = perFrame(draw);

  const settle = () => {
    const frame = dockedFrame();
    const rect = clampFloatRect(wanted(), getGeometry());
    if (!frame) {
      fileViewer.setRect(rect);
      return;
    }
    const from = frame.getBoundingClientRect();
    flushSync(() => fileViewer.setRect(rect));
    frame.style.transform = "";
    frame.style.transformOrigin = "";
    frame.removeAttribute("data-interacting");
    const away = Math.abs(from.x - rect.x) + Math.abs(from.y - rect.y);
    if (away < 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    frame.animate(
      [
        {
          transformOrigin: "0 0",
          transform: `translate3d(${from.x - rect.x}px, ${from.y - rect.y}px, 0) scale(${from.width / rect.width})`,
        },
        { transformOrigin: "0 0", transform: "none" },
      ],
      { duration: SETTLE_MS, easing: SETTLE_EASING },
    );
  };

  const held = dockedFrame();
  if (held) beginInteraction(held);
  const stopTracking = trackPointer(down.pointerId, "grabbing", {
    move: (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      screen = { x: event.screenX, y: event.screenY };
      steps.request();
    },
    end: () => {
      steps.flush();
      ended = true;
      if (torn) focusViewerWindow(torn);
      else settle();
    },
  });
};

/**
 * A sandboxed page lays out in its own process, which each resize frame would
 * wait for. It keeps its size while the frame moves and catches up at rests.
 */
const holdPageSize = (frame: HTMLElement | null) => {
  const host = frame
    ?.querySelector(".file-viewer__item[data-retained-surface='shown'] iframe")
    ?.closest<HTMLElement>(".file-viewer__host");
  if (!host) return null;
  let rest = 0;
  const release = () => {
    clearTimeout(rest);
    rest = 0;
    host.style.width = "";
    host.style.height = "";
  };
  return {
    hold: () => {
      if (rest) clearTimeout(rest);
      else {
        const { offsetWidth, offsetHeight } = host;
        host.style.width = `${offsetWidth}px`;
        host.style.height = `${offsetHeight}px`;
      }
      rest = window.setTimeout(release, PAGE_REST_MS);
    },
    release,
  };
};

export const resizeViewer = (
  down: ViewerGestureStart,
  cursor: string,
  start: FileViewerRect,
  apply: (dx: number, dy: number, start: FileViewerRect) => FileViewerRect,
  /** Runs once, when the pointer first really moves: an expanded viewer floats at `start` there. */
  onFirstMove?: () => void,
): void => {
  let latest = start;
  let pointer: Point = { x: down.clientX, y: down.clientY };
  let moved = false;
  const steps = perFrame(() => {
    latest = clampFloatRect(
      apply(pointer.x - down.clientX, pointer.y - down.clientY, start),
      getGeometry(),
    );
    const frame = dockedFrame();
    if (!frame) return;
    page?.hold();
    frame.style.left = `${latest.x}px`;
    frame.style.top = `${latest.y}px`;
    frame.style.width = `${latest.width}px`;
    frame.style.height = `${latest.height}px`;
  });
  const resized = dockedFrame();
  const page = holdPageSize(resized);
  if (resized) beginInteraction(resized);
  trackPointer(down.pointerId, cursor, {
    move: (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (!moved) {
        const dx = pointer.x - down.clientX;
        const dy = pointer.y - down.clientY;
        if (Math.hypot(dx, dy) < RESIZE_SLOP) return;
        moved = true;
        if (onFirstMove) flushSync(onFirstMove);
      }
      steps.request();
    },
    end: () => {
      steps.flush();
      if (moved) flushSync(() => fileViewer.setRect(latest));
      page?.release();
      dockedFrame()?.removeAttribute("data-interacting");
    },
  });
};
