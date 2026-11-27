import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BoxProps, Effect, FadeEdge } from "../../host/rune-jsx/props";
import { registerAll } from "./files";
import { pushModal, topLayerRoot, trackAnchor } from "./overlay";
import { focusIsKeyboard, matchChord, modsOf, register, unregister, watchLayout } from "./registry";
import { boxStyle, presenceEffect, springCurve, transformCss, type Css } from "./style";
import { hideTip, showTip } from "./tooltip";

type DomProps = Record<string, unknown> & { className: string; style: Css; ref: (el: HTMLElement | null) => void };

const FOCUSABLE = "[tabindex]:not([tabindex='-1']), input:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]";
const DRAG_THRESHOLD = 3;
const AT_BOTTOM_PX = 4;

let pressKeys = false;

/** Whether the press being handled came from Return or Space (a `click` with `detail` 0), as the native host's `stella.pressedByKeys`; it holds until React DOM has flushed the press's render. */
export const pressedByKeys = () => pressKeys;

function pressFrom(keys: boolean, press: () => void) {
  pressKeys = keys;
  queueMicrotask(() => {
    pressKeys = false;
  });
  press();
}

const effectFrame = (e: Effect, base: string | undefined): Keyframe => ({
  opacity: e.opacity ?? 1,
  transform: `${base ? `${base} ` : ""}translate(${e.x ?? 0}px, ${e.y ?? 0}px) scale(${e.scale ?? 1})`,
  ...(e.blur ? { filter: `blur(${e.blur}px)` } : {}),
});

function playPresence(el: HTMLElement, p: BoxProps, which: "enter" | "exit"): Animation | null {
  const spec = which === "enter" ? p.enter : p.exit;
  if (!spec || typeof el.animate !== "function") return null;
  const e = presenceEffect(spec);
  const base = transformCss(p);
  const rest: Keyframe = { opacity: p.opacity ?? 1, transform: base ?? "none", ...(e.blur ? { filter: "blur(0px)" } : {}) };
  const from = effectFrame(e, base);
  const frames = which === "enter" ? [from, rest] : [rest, from];
  return el.animate(frames, { duration: (e.dur ?? 0.3) * 1000, easing: springCurve(e.bounce ?? 0), fill: which === "exit" ? "forwards" : "none" });
}

/** Keeps the element on screen after React removes it, playing its `exit` (Rune keeps exiting nodes until they finish). */
function playExit(el: HTMLElement, p: BoxProps) {
  if (!el.isConnected || !el.parentNode) return;
  const clone = el.cloneNode(true) as HTMLElement;
  delete clone.dataset.rid;
  for (const n of clone.querySelectorAll<HTMLElement>("[data-rid]")) delete n.dataset.rid;
  clone.style.pointerEvents = "none";
  clone.setAttribute("aria-hidden", "true");
  clone.inert = true;
  el.parentNode.insertBefore(clone, el.nextSibling);
  if (el.scrollTop) clone.scrollTop = el.scrollTop;
  const anim = playPresence(clone, p, "exit");
  const done = () => clone.remove();
  if (anim) {
    anim.onfinish = done;
    anim.oncancel = done;
  } else done();
}

function maskFor(el: HTMLElement, p: BoxProps): string {
  const top: FadeEdge | undefined = p.scrollFade?.top ?? (p.edgeFade ? { size: p.edgeFade } : undefined);
  const bottom: FadeEdge | undefined = p.scrollFade?.bottom ?? (p.edgeFade ? { size: p.edgeFade } : undefined);
  const above = el.scrollTop;
  const below = el.scrollHeight - el.clientHeight - el.scrollTop;
  const strength = (edge: FadeEdge, room: number) => Math.max(0, Math.min(1, room / (edge.fullAt ?? edge.size)));
  const stopsOf = (edge: FadeEdge): [number, number][] => edge.stops?.length ? edge.stops : edge.linear ? [[0, 0], [1, 1]] : [[0, 0], [0.5, 0.6], [1, 1]];
  const parts: string[] = [];
  if (top) {
    const k = strength(top, above);
    for (const [pos, alpha] of stopsOf(top)) parts.push(`rgba(0,0,0,${(1 - k * (1 - alpha)).toFixed(3)}) ${(pos * top.size).toFixed(1)}px`);
  } else parts.push("#000 0px");
  if (bottom) {
    const k = strength(bottom, below);
    for (const [pos, alpha] of [...stopsOf(bottom)].reverse()) parts.push(`rgba(0,0,0,${(1 - k * (1 - alpha)).toFixed(3)}) calc(100% - ${(pos * bottom.size).toFixed(1)}px)`);
  } else parts.push("#000 100%");
  return `linear-gradient(to bottom, ${parts.join(", ")})`;
}

function wireScroll(el: HTMLElement, get: () => BoxProps): () => void {
  let atBottom: boolean | null = null;
  let far: boolean | null = null;
  let pinned = true;
  let programmatic = false;
  const report = () => {
    const p = get();
    const max = el.scrollHeight - el.clientHeight;
    const distance = max - el.scrollTop;
    if (p.onScroll) p.onScroll({ x: el.scrollLeft, y: el.scrollTop, maxX: el.scrollWidth - el.clientWidth, maxY: Math.max(0, max), viewport: [el.clientWidth, el.clientHeight] });
    const nowAt = distance <= AT_BOTTOM_PX;
    if (nowAt !== atBottom) {
      atBottom = nowAt;
      p.onAtBottom?.(nowAt);
    }
    const nowFar = distance > (p.farFromBottom ?? 180);
    if (nowFar !== far) {
      far = nowFar;
      p.onFarFromBottom?.(nowFar);
    }
    if (p.scrollFade || p.edgeFade) {
      const mask = maskFor(el, p);
      el.style.maskImage = mask;
      el.style.webkitMaskImage = mask;
    }
  };
  const onScroll = () => {
    if (!programmatic) pinned = el.scrollHeight - el.clientHeight - el.scrollTop <= AT_BOTTOM_PX;
    programmatic = false;
    report();
  };
  const follow = () => {
    if (get().stickBottom && pinned) {
      const max = el.scrollHeight - el.clientHeight;
      if (Math.abs(el.scrollTop - max) > 0.5) {
        programmatic = true;
        el.scrollTop = max;
      }
    }
    report();
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  const ro = new ResizeObserver(follow);
  ro.observe(el);
  const observeChildren = () => { for (const c of el.children) ro.observe(c); };
  observeChildren();
  const mo = new MutationObserver(() => { observeChildren(); follow(); });
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  const userScroll = () => { pinned = el.scrollHeight - el.clientHeight - el.scrollTop <= AT_BOTTOM_PX; };
  el.addEventListener("wheel", userScroll, { passive: true });
  el.addEventListener("touchmove", userScroll, { passive: true });
  if (get().stickBottom) {
    programmatic = true;
    el.scrollTop = el.scrollHeight;
  }
  requestAnimationFrame(report);
  (el as HTMLElement & { __runeUnpin?: () => void; __runePin?: () => void }).__runeUnpin = () => { pinned = false; };
  (el as HTMLElement & { __runePin?: () => void }).__runePin = () => { pinned = true; };
  return () => {
    el.removeEventListener("scroll", onScroll);
    el.removeEventListener("wheel", userScroll);
    el.removeEventListener("touchmove", userScroll);
    ro.disconnect();
    mo.disconnect();
  };
}

function moveFocusInGroup(group: HTMLElement, e: React.KeyboardEvent, typed: { text: string; at: number }) {
  const items = [...group.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest(".hid, .dis") && n.offsetParent !== null && n.closest("[data-focus-group]") === group);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const vertical = e.key === "ArrowDown" || e.key === "ArrowUp";
  const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
  let next: HTMLElement | undefined;
  if (vertical || horizontal) {
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
    next = items[i < 0 ? (forward ? 0 : items.length - 1) : (i + (forward ? 1 : -1) + items.length) % items.length];
  } else if (e.key === "Home") next = items[0];
  else if (e.key === "End") next = items[items.length - 1];
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const now = performance.now();
    typed.text = now - typed.at < 700 ? typed.text + e.key.toLowerCase() : e.key.toLowerCase();
    typed.at = now;
    const start = i < 0 ? 0 : i + (typed.text.length === 1 ? 1 : 0);
    for (let k = 0; k < items.length; k++) {
      const item = items[(start + k) % items.length]!;
      const label = (item.getAttribute("aria-label") ?? item.textContent ?? "").trim().toLowerCase();
      if (label.startsWith(typed.text)) { next = item; break; }
    }
  }
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

export type Host = { props: DomProps; wrap: (node: ReactNode) => ReactNode; el: React.RefObject<HTMLElement | null> };

/** Everything a host element shares (host/ELEMENTS.md, "Common props"): layout, paint, states, motion, events, scroll, overlays. */
export function useHost(p: BoxProps, base: string): Host {
  const el = useRef<HTMLElement | null>(null);
  const latest = useRef(p);
  latest.current = p;
  const get = useCallback(() => latest.current, []);
  const id = p.id;
  const { className, style } = boxStyle(p, base);
  const layer = p.fixed || p.anchor;
  if (layer) style.pointerEvents = p.inert ? "none" : "auto";
  if (p.anchor) {
    style.position = "fixed";
    style.left ??= 0;
    style.top ??= 0;
    if (p.scrollY) style.overflowY = "auto";
  }

  const ref = useCallback((node: HTMLElement | null) => {
    if (el.current && el.current !== node && id) unregister(id, el.current);
    el.current = node;
    if (node && id) register(id, node);
  }, [id]);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const p0 = latest.current;
    if (p0.enter && !p0.instant) playPresence(node, p0, "enter");
    if (p0.autoFocus) node.focus({ preventScroll: true });
    return () => {
      const p1 = latest.current;
      if (p1.exit && !p1.instant) playExit(node, p1);
      hideTip(node);
    };
  }, []);

  const wantsLayout = !!(p.onLayout || p.onSize);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !wantsLayout) return;
    let sized: { w: number; h: number } | undefined;
    const w = watchLayout(node, (r) => {
      latest.current.onLayout?.(r);
      if (!latest.current.onSize || (sized && sized.w === r.w && sized.h === r.h)) return;
      sized = { w: r.w, h: r.h };
      latest.current.onSize(sized);
    });
    return () => w.stop();
  }, [wantsLayout]);

  const scrolls = !!(p.scrollY || p.scrollX);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !scrolls) return;
    return wireScroll(node, get);
  }, [scrolls, get]);

  const anchorTo = p.anchor?.to;
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !anchorTo) return;
    return trackAnchor(node, () => latest.current.anchor ?? { to: anchorTo });
  }, [anchorTo]);

  const modal = !!p.modal;
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !modal) return;
    return pushModal(node, () => ({ modal: latest.current.modal ?? {}, onDismiss: latest.current.onDismiss }));
  }, [modal]);

  const typed = useRef({ text: "", at: 0 });
  const dropDepth = useRef(0);
  const drag = useRef<{ x: number; y: number; started: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);

  const d: DomProps = { className, style, ref };
  if (p.dir) d.dir = p.dir;
  if (p.role) d.role = p.role;
  if (p.label) d["aria-label"] = p.label;
  if (p.checked !== undefined && p.role && /checkbox|switch|radio|menuitemcheckbox|menuitemradio/.test(p.role)) d["aria-checked"] = p.checked;
  if (p.expanded !== undefined) d["aria-expanded"] = p.expanded;
  if (p.selected !== undefined) d["aria-selected"] = p.selected;
  if (p.disabled) d["aria-disabled"] = true;
  if (p.hidden) d["aria-hidden"] = true;
  if (p.inert) d.inert = true;
  if (p.focusGroup) d["data-focus-group"] = "";
  if (p.autoFocus) d["data-autofocus"] = "";
  const tabIndex = p.tabIndex ?? (p.focusable ? 0 : undefined);
  if (tabIndex !== undefined && !p.disabled) d.tabIndex = tabIndex;
  if (p.modal && tabIndex === undefined) d.tabIndex = -1;

  if (p.onPress || p.onDoublePress) {
    d.onClick = (e: React.MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      const q = latest.current;
      if (!q.onPress || q.disabled) return;
      e.stopPropagation();
      pressFrom(e.detail === 0, q.onPress);
    };
  }
  if (p.onDoublePress) {
    d.onDoubleClick = (e: React.MouseEvent) => {
      const q = latest.current;
      if (q.disabled) return;
      e.stopPropagation();
      q.onDoublePress?.();
    };
  }
  if (p.onContextMenu) {
    d.onContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      latest.current.onContextMenu?.({ x: e.clientX, y: e.clientY });
    };
  }
  if (p.onHover || p.title) {
    d.onPointerEnter = (e: React.PointerEvent) => {
      const q = latest.current;
      q.onHover?.(true);
      if (q.title && e.pointerType !== "touch") showTip(e.currentTarget as HTMLElement, q.title, q.titleSide);
    };
    d.onPointerLeave = (e: React.PointerEvent) => {
      latest.current.onHover?.(false);
      hideTip(e.currentTarget as HTMLElement);
    };
  }
  if (p.title) d["aria-description"] = p.title;
  if (p.onFocus || p.onFocusWithin) {
    d.onFocus = (e: React.FocusEvent) => {
      const q = latest.current;
      if (e.target === e.currentTarget) q.onFocus?.(true, focusIsKeyboard());
      if (q.onFocusWithin && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) q.onFocusWithin(true);
    };
    d.onBlur = (e: React.FocusEvent) => {
      const q = latest.current;
      if (e.target === e.currentTarget) q.onFocus?.(false, false);
      if (q.onFocusWithin && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) q.onFocusWithin(false);
    };
  }
  if (p.keys?.length || p.focusGroup || (p.onPress && tabIndex !== undefined)) {
    d.onKeyDown = (e: React.KeyboardEvent) => {
      const q = latest.current;
      const chord = matchChord(q.keys, e.nativeEvent);
      if (chord) {
        e.preventDefault();
        e.stopPropagation();
        q.onKey?.({ key: e.key, chord, mods: modsOf(e) });
        return;
      }
      if (q.onPress && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && !q.disabled) {
        e.preventDefault();
        e.stopPropagation();
        pressFrom(true, q.onPress);
        return;
      }
      if (q.focusGroup && el.current) moveFocusInGroup(el.current, e, typed.current);
    };
  }
  if (p.dragOut?.text || p.dragOut?.paths?.length) {
    d.draggable = true;
    d.onDragStart = (e: React.DragEvent) => {
      const out = latest.current.dragOut;
      if (out?.text) e.dataTransfer.setData("text/plain", out.text);
      else if (out?.paths?.length) e.dataTransfer.setData("text/plain", out.paths.join("\n"));
      e.dataTransfer.effectAllowed = "copy";
    };
  }
  if (p.onDropFiles || p.onDropHover) {
    const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");
    d.onDragEnter = (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (dropDepth.current++ === 0) latest.current.onDropHover?.(true);
    };
    d.onDragOver = (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    d.onDragLeave = (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      if (--dropDepth.current <= 0) {
        dropDepth.current = 0;
        latest.current.onDropHover?.(false);
      }
    };
    d.onDrop = (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dropDepth.current = 0;
      const q = latest.current;
      q.onDropHover?.(false);
      const paths = registerAll(e.dataTransfer.files, q.dropExts);
      if (paths.length) q.onDropFiles?.(paths);
    };
  }
  if (p.onDrag) {
    d.onPointerDown = (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY, started: false, id: e.pointerId };
    };
    d.onPointerMove = (e: React.PointerEvent) => {
      const s = drag.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.started) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        s.started = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        latest.current.onDrag?.({ phase: "start", dx: 0, dy: 0, x: s.x, y: s.y });
      }
      e.stopPropagation();
      latest.current.onDrag?.({ phase: "move", dx, dy, x: e.clientX, y: e.clientY });
    };
    const end = (e: React.PointerEvent) => {
      const s = drag.current;
      drag.current = null;
      if (!s || !s.started) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      latest.current.onDrag?.({ phase: "end", dx: e.clientX - s.x, dy: e.clientY - s.y, x: e.clientX, y: e.clientY });
    };
    d.onPointerUp = end;
    d.onPointerCancel = end;
  }

  const wrap = (node: ReactNode) => (layer ? createPortal(node, topLayerRoot()) : node);
  return { props: d, wrap, el };
}
