import { useCallback, useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { sidebarSections } from "@/features/workspace-display/sidebar-sections";

const ACTIVATION_DISTANCE = 4;
const SETTLE_MS = 170;
const EDGE_SCROLL_ZONE = 28;
const EDGE_SCROLL_STEP = 7;
const TAB_SELECTOR = ".topbar-tabs__tab[data-tab-id]";

type Slot = { el: HTMLElement; left: number; width: number };

type Drag = {
  id: string;
  pointerId: number;
  el: HTMLElement;
  startX: number;
  lastX: number;
  startScroll: number;
  active: boolean;
  slots: Slot[];
  from: number;
  target: number;
  gap: number;
  frame: number;
  settle: number;
};

/**
 * Drag a top-bar tab sideways to reorder it. The Chat tab carries no
 * `data-tab-id`, so it never moves and nothing can be dropped before it.
 */
export function useTabReorder(
  stripRef: RefObject<HTMLDivElement | null>,
  tabIds: string,
) {
  const dragRef = useRef<Drag | null>(null);
  const stopRef = useRef<(commit: boolean, animate: boolean) => void>(() => {});

  const onTabPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>, tabId: string) => {
      if (event.button !== 0 || dragRef.current) return;
      if ((event.target as HTMLElement).closest(".topbar-tabs__close")) return;
      const strip = stripRef.current;
      if (!strip) return;

      const drag: Drag = {
        id: tabId,
        pointerId: event.pointerId,
        el: event.currentTarget,
        startX: event.clientX,
        lastX: event.clientX,
        startScroll: strip.scrollLeft,
        active: false,
        slots: [],
        from: -1,
        target: -1,
        gap: 0,
        frame: 0,
        settle: 0,
      };
      dragRef.current = drag;

      const place = () => {
        const dragged = drag.slots[drag.from]!;
        const first = drag.slots[0]!;
        const last = drag.slots[drag.slots.length - 1]!;
        const raw = drag.lastX - drag.startX + strip.scrollLeft - drag.startScroll;
        const dx = Math.min(
          last.left + last.width - dragged.left - dragged.width,
          Math.max(first.left - dragged.left, raw),
        );
        const left = dragged.left + dx;
        const right = left + dragged.width;
        const step = dragged.width + drag.gap;
        let target = drag.from;
        drag.slots.forEach((slot, index) => {
          if (index === drag.from) return;
          const middle = slot.left + slot.width / 2;
          let shift = 0;
          if (index < drag.from && left < middle) {
            shift = step;
            target -= 1;
          } else if (index > drag.from && right > middle) {
            shift = -step;
            target += 1;
          }
          slot.el.style.transform = shift ? `translate3d(${shift}px,0,0)` : "";
        });
        drag.target = target;
        drag.el.style.transform = `translate3d(${dx}px,0,0)`;
      };

      const edgeScroll = () => {
        drag.frame = 0;
        if (dragRef.current !== drag || !drag.active) return;
        if (strip.scrollWidth <= strip.clientWidth) return;
        const bounds = strip.getBoundingClientRect();
        const chat = strip.querySelector<HTMLElement>(".topbar-tabs__tab--chat");
        const leftEdge = bounds.left + (chat?.offsetWidth ?? 0);
        const before = strip.scrollLeft;
        if (drag.lastX < leftEdge + EDGE_SCROLL_ZONE) {
          strip.scrollLeft -= EDGE_SCROLL_STEP;
        } else if (drag.lastX > bounds.right - EDGE_SCROLL_ZONE) {
          strip.scrollLeft += EDGE_SCROLL_STEP;
        }
        if (strip.scrollLeft !== before) {
          place();
          drag.frame = requestAnimationFrame(edgeScroll);
        }
      };

      const activate = () => {
        const tabs = [...strip.querySelectorAll<HTMLElement>(TAB_SELECTOR)];
        drag.from = tabs.indexOf(drag.el);
        if (drag.from === -1 || tabs.length < 2) return false;
        drag.slots = tabs.map((el) => {
          const rect = el.getBoundingClientRect();
          return { el, left: rect.left, width: rect.width };
        });
        drag.target = drag.from;
        drag.gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
        drag.active = true;
        strip.dataset.reordering = "true";
        drag.el.dataset.dragging = "true";
        try {
          drag.el.setPointerCapture(drag.pointerId);
        } catch {
          // The pointer is already gone; the window listeners still end it.
        }
        return true;
      };

      const onMove = (move: globalThis.PointerEvent) => {
        if (move.pointerId !== drag.pointerId || drag.settle) return;
        drag.lastX = move.clientX;
        if (!drag.active) {
          if (Math.abs(move.clientX - drag.startX) < ACTIVATION_DISTANCE) return;
          if (!activate()) {
            stop(false, false);
            return;
          }
        }
        place();
        if (!drag.frame) drag.frame = requestAnimationFrame(edgeScroll);
      };

      const swallowClick = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };

      const clear = (commit: boolean) => {
        for (const slot of drag.slots) {
          slot.el.style.transition = "none";
          slot.el.style.transform = "";
        }
        if (commit && drag.target !== drag.from) {
          flushSync(() => sidebarSections.moveTab(drag.id, drag.target));
        }
        void strip.offsetWidth;
        for (const slot of drag.slots) slot.el.style.transition = "";
        delete drag.el.dataset.dragging;
        delete drag.el.dataset.settling;
        delete strip.dataset.reordering;
        stopRef.current = () => {};
        if (dragRef.current === drag) dragRef.current = null;
      };

      const stop = (commit: boolean, animate: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onCancel);
        if (drag.frame) cancelAnimationFrame(drag.frame);
        drag.frame = 0;
        if (drag.settle) window.clearTimeout(drag.settle);
        drag.settle = 0;
        if (!drag.active) {
          if (dragRef.current === drag) dragRef.current = null;
          return;
        }
        if (drag.el.hasPointerCapture(drag.pointerId)) {
          drag.el.releasePointerCapture(drag.pointerId);
        }
        if (!animate) {
          clear(false);
          return;
        }
        let rest = 0;
        if (commit) {
          const [low, high] =
            drag.target > drag.from
              ? [drag.from + 1, drag.target + 1]
              : [drag.target, drag.from];
          for (const slot of drag.slots.slice(low, high)) {
            rest += slot.width + drag.gap;
          }
          if (drag.target < drag.from) rest = -rest;
        } else {
          for (const slot of drag.slots) {
            if (slot.el !== drag.el) slot.el.style.transform = "";
          }
        }
        drag.el.dataset.settling = "true";
        drag.el.style.transform = rest ? `translate3d(${rest}px,0,0)` : "";
        stopRef.current = () => {
          window.clearTimeout(drag.settle);
          clear(false);
        };
        drag.settle = window.setTimeout(() => clear(commit), SETTLE_MS);
      };

      const onUp = (up: globalThis.PointerEvent) => {
        if (up.pointerId !== drag.pointerId) return;
        if (drag.active) {
          window.addEventListener("click", swallowClick, true);
          window.setTimeout(
            () => window.removeEventListener("click", swallowClick, true),
            0,
          );
        }
        stop(true, true);
      };

      const onCancel = () => stop(false, true);

      const onKey = (key: KeyboardEvent) => {
        if (key.key !== "Escape" || !drag.active) return;
        key.preventDefault();
        key.stopPropagation();
        window.addEventListener("click", swallowClick, true);
        const release = () => {
          window.removeEventListener("pointerup", release);
          window.setTimeout(
            () => window.removeEventListener("click", swallowClick, true),
            0,
          );
        };
        window.addEventListener("pointerup", release);
        stop(false, true);
      };

      stopRef.current = stop;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onCancel);
    },
    [stripRef],
  );

  // A tab opening or closing mid-drag makes the measured slots stale.
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag?.active && !drag.settle) stopRef.current(false, false);
    },
    [tabIds],
  );

  useEffect(() => () => stopRef.current(false, false), []);

  return onTabPointerDown;
}
