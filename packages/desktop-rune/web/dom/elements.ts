import { createElement, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode, type Ref } from "react";
import type { BoxProps, IconProps, ImageProps, ListProps, MediaProps, Run, SurfaceProps, TextProps, VectorProps, WebviewProps, WindowProps } from "../../host/rune-jsx/props";
import { useHost } from "./host";
import { matchChord, modsOf, register, unregister } from "./registry";
import { textStyle, type Css } from "./style";

type Patch = Record<string, unknown>;

/** A ref's `set(patch)`: props changed outside React, kept over React's own until set again (host/reconciler.ts). */
function useDirect<P extends object>(props: P, onPatch?: (patch: Patch) => boolean): P {
  const direct = useRef<Patch | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const ref = (props as { ref?: Ref<unknown> }).ref;
  useImperativeHandle(ref, () => ({
    set(patch: Patch) {
      direct.current = { ...direct.current, ...patch };
      if (!onPatch?.(patch)) bump();
    },
  }), []);
  return direct.current ? { ...props, ...direct.current } : props;
}

const BOX_CLASS = { row: "r", col: "r col", box: "r" } as const;

export function Box(kind: "row" | "col" | "box") {
  const Component = (raw: BoxProps) => {
    const p = useDirect(raw);
    const h = useHost(p, BOX_CLASS[kind]);
    return h.wrap(createElement("div", h.props, p.children));
  };
  Component.displayName = kind;
  return Component;
}

function runStyle(r: Run): Css | undefined {
  const s: Css = {};
  if (r.w) s.fontWeight = r.w;
  if (r.c) s.color = r.c;
  if (r.m) s.fontFamily = "var(--rune-mono)";
  if (r.bg) {
    s.backgroundColor = r.bg;
    s.borderRadius = `${r.box?.radius ?? 3}px`;
    s.boxDecorationBreak = "clone";
    if (r.box?.pad) s.paddingInline = `${r.box.pad}px`;
    if (r.box?.margin) s.marginInline = `${r.box.margin}px`;
  }
  if (r.i) s.fontStyle = "italic";
  if (r.u) {
    s.textDecorationLine = "underline";
    s.textDecorationColor = r.u;
  }
  if (r.st) s.textDecorationLine = r.u ? "underline line-through" : "line-through";
  if (r.s) s.fontSize = `${r.s}px`;
  return Object.keys(s).length ? s : undefined;
}

function textOf(children: ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === "string" || typeof c === "number" || c == null || c === false)) return children.filter((c) => c != null && c !== false).join("");
  return null;
}

/** `truncate="middle"`: the head ellipsizes, the tail (about a third, from a word boundary when one is near) always shows. */
function middle(text: string): ReactNode {
  const cut = Math.max(1, Math.floor(text.length * 0.62));
  const boundary = text.slice(cut).search(/[\s._-]/);
  const at = boundary >= 0 && boundary < 6 ? cut + boundary : cut;
  return [
    createElement("span", { key: "h", className: "tmh" }, text.slice(0, at)),
    createElement("span", { key: "t", className: "tmt" }, text.slice(at)),
  ];
}

export function Text(raw: TextProps) {
  const p = useDirect(raw);
  const cls = ["rt"];
  const clamp = p.maxLines && (p.maxLines > 1 || !p.truncate) ? p.maxLines : 0;
  const truncate = clamp ? undefined : p.truncate === true ? "end" : p.truncate;
  if (truncate === "end") cls.push("tr");
  else if (truncate === "fade") cls.push("tf");
  else if (truncate === "head") cls.push("th");
  else if (truncate === "middle") cls.push("tm");
  else if (p.nowrap) cls.push("nw");
  if (clamp) cls.push("ml");
  if (p.selectable) cls.push("sel");
  if (p.antialias) cls.push("aa");
  const h = useHost(p, cls.join(" "));
  const s = h.props.style;
  textStyle(p, s);
  if (clamp) s.WebkitLineClamp = clamp;
  if (p.balance) s.textWrap = "balance";
  if (p.selectionColor) s["--rsel"] = p.selectionColor;
  let content: ReactNode;
  if (p.spans) {
    content = p.spans.map((r, i) => {
      const style = runStyle(r);
      if (r.href) {
        return createElement("span", {
          key: i, className: "lk", style, role: "link", tabIndex: -1,
          onClick: (e: React.MouseEvent) => {
            if (!p.onLink) return;
            e.stopPropagation();
            p.onLink(r.href!);
          },
        }, r.t);
      }
      return style ? createElement("span", { key: i, style }, r.t) : r.t;
    });
  } else {
    const t = textOf(p.children);
    content = t !== null && truncate === "middle" ? middle(t) : truncate === "head" && t !== null ? createElement("span", { className: "ltr" }, t) : p.children;
  }
  return h.wrap(createElement("div", h.props, content));
}

export function Icon(raw: IconProps) {
  const p = useDirect(raw);
  const h = useHost(p, "ri");
  const px = p.size ?? 16;
  const s = h.props.style;
  s.width ??= `${px}px`;
  s.height ??= `${px}px`;
  if (p.color) s.color = p.color;
  if (p.spin) s.animation = `rune-spin ${Math.max(0.05, p.spin)}s linear infinite`;
  const view = p.view ?? 24;
  const html = useMemo(() => ({ __html: p.svg }), [p.svg]);
  return h.wrap(createElement("svg", { ...h.props, xmlns: "http://www.w3.org/2000/svg", viewBox: `0 0 ${view} ${view}`, fill: "none", "aria-hidden": h.props.role || h.props["aria-label"] ? undefined : true, dangerouslySetInnerHTML: html }));
}

function vectorHtml(p: VectorProps): string {
  if (p.svg) return p.svg.replace(/<svg\b/, '<svg preserveAspectRatio="none" width="100%" height="100%"');
  const [w, h] = p.viewBox ?? [24, 24];
  const body = (p.paths ?? []).map((path) => {
    const attrs = [`d="${path.d}"`];
    attrs.push(`fill="${path.fill ?? "none"}"`);
    if (path.stroke) attrs.push(`stroke="${path.stroke}"`, `stroke-width="${path.strokeWidth ?? 1}"`, `stroke-linecap="${path.cap ?? "round"}"`, `stroke-linejoin="round"`);
    if (path.opacity !== undefined) attrs.push(`opacity="${path.opacity}"`);
    if (path.evenOdd) attrs.push(`fill-rule="evenodd"`);
    return `<path ${attrs.join(" ")}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="100%">${body}</svg>`;
}

export function Vector(raw: VectorProps) {
  const holder = useRef<HTMLElement | null>(null);
  const p = useDirect(raw, (patch) => {
    if (Object.keys(patch).length !== 1 || typeof patch.svg !== "string" || !holder.current) return false;
    holder.current.innerHTML = vectorHtml({ ...raw, svg: patch.svg });
    return true;
  });
  const h = useHost(p, "ri");
  holder.current = h.el.current;
  const html = vectorHtml(p);
  useLayoutEffect(() => { holder.current = h.el.current; });
  return h.wrap(createElement("span", { ...h.props, dangerouslySetInnerHTML: { __html: html } }));
}

const FIT: Record<string, string> = { cover: "cover", contain: "contain", stretch: "fill" };

const webSrc = (src: string) => (src.startsWith("file://") ? "" : src);

export function Image(raw: ImageProps) {
  const p = useDirect(raw);
  const h = useHost(p, "rimg");
  const s = h.props.style;
  const src = webSrc(p.src);
  if (p.tint) {
    s.backgroundColor = p.tint;
    s.maskImage = `url("${src}")`;
    s.WebkitMaskImage = s.maskImage;
    s.maskSize = p.fit === "cover" ? "cover" : p.fit === "stretch" ? "100% 100%" : "contain";
    s.WebkitMaskSize = s.maskSize;
    s.maskRepeat = "no-repeat";
    s.maskPosition = "center";
    return h.wrap(createElement("div", { ...h.props, role: p.role ?? "img" }));
  }
  s.objectFit = (FIT[p.fit ?? "cover"] ?? "cover") as Css["objectFit"];
  if (p.w === undefined || p.h === undefined) {
    if (p.w === undefined) s.width ??= "auto";
    if (p.h === undefined) s.height ??= "auto";
    s.maxWidth ??= "100%";
    s.maxHeight ??= "100%";
    if (p.w === undefined && p.h === undefined) {
      s.alignSelf ??= "flex-start";
      s.flexShrink = 1;
      s.minWidth ??= 0;
    }
  }
  return h.wrap(createElement("img", { ...h.props, src: src || undefined, alt: p.label ?? "", draggable: false, decoding: "async" }));
}

export function Surface(raw: SurfaceProps) {
  const p = useDirect(raw);
  const h = useHost(p, "rimg");
  const s = h.props.style;
  s.objectFit = p.fit === "contain" ? "contain" : "fill";
  const button = (b: number) => (["left", "middle", "right", "back", "forward"][b] ?? "other") as "left";
  const point = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pointer = (kind: "move" | "down" | "up" | "leave") => (e: React.PointerEvent) => {
    if (kind === "down") (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    p.onPointer?.({ kind, ...point(e), button: kind === "move" || kind === "leave" ? null : button(e.button), buttons: e.buttons, clicks: e.detail, mods: modsOf(e) });
  };
  return h.wrap(createElement("img", {
    ...h.props,
    src: p.src ? webSrc(p.src) || undefined : undefined,
    alt: "",
    draggable: false,
    tabIndex: 0,
    onPointerMove: p.onPointer ? pointer("move") : undefined,
    onPointerDown: p.onPointer ? pointer("down") : undefined,
    onPointerUp: p.onPointer ? pointer("up") : undefined,
    onPointerLeave: p.onPointer ? pointer("leave") : undefined,
    onWheel: p.onWheel ? (e: React.WheelEvent) => p.onWheel?.({ ...point(e), dx: -e.deltaX, dy: -e.deltaY, mode: e.deltaMode === 1 ? "line" : "pixel", mods: modsOf(e) }) : undefined,
    onKeyDown: p.onKeyRaw ? (e: React.KeyboardEvent) => { e.preventDefault(); p.onKeyRaw?.({ type: "down", key: e.key, text: e.key.length === 1 ? e.key : null, mods: modsOf(e) }); } : undefined,
    onKeyUp: p.onKeyRaw ? (e: React.KeyboardEvent) => p.onKeyRaw?.({ type: "up", key: e.key, text: null, mods: modsOf(e) }) : undefined,
  }));
}

export function Media(kind: "video" | "audio") {
  const Component = (raw: MediaProps) => {
    const p = useDirect(raw);
    const h = useHost(p, "rimg");
    h.props.style.objectFit = p.fit ?? "contain";
    return h.wrap(createElement(kind, { ...h.props, src: webSrc(p.src) || undefined, autoPlay: p.autoplay, muted: p.muted, loop: p.loopMedia, playsInline: true, preload: "metadata" }));
  };
  Component.displayName = kind;
  return Component;
}

export function List(raw: ListProps) {
  const p = useDirect(raw);
  const h = useHost(p, "r col");
  const last = useRef("");
  const wants = !!p.onVisibleRows;
  const latest = useRef(p);
  latest.current = p;
  useLayoutEffect(() => {
    const el = h.el.current;
    if (!el || !wants) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scroller = el.closest(".sy") as HTMLElement | null;
      const view = (scroller ?? document.documentElement).getBoundingClientRect();
      const rows = el.children;
      let first = -1;
      let lastRow = -1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect();
        if (r.bottom > view.top && r.top < view.bottom) {
          if (first < 0) first = i;
          lastRow = i;
        }
      }
      if (first < 0) first = lastRow = 0;
      const key = `${first}:${lastRow}:${rows.length}`;
      if (key === last.current) return;
      last.current = key;
      latest.current.onVisibleRows?.({ first, last: lastRow, end: rows.length });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    schedule();
    const scroller = el.closest(".sy");
    scroller?.addEventListener("scroll", schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller?.removeEventListener("scroll", schedule);
      ro.disconnect();
      mo.disconnect();
    };
  }, [wants]);
  return h.wrap(createElement("div", h.props, p.children));
}

export function Webview(raw: WebviewProps) {
  const p = useDirect(raw);
  const h = useHost({ ...p, id: undefined }, "rwv");
  const frame = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef(p);
  latest.current = p;
  useLayoutEffect(() => {
    const f = frame.current;
    if (!f || !p.id) return;
    register(p.id, f);
    return () => unregister(p.id!, f);
  }, [p.id]);
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const f = frame.current;
      if (!f || e.source !== f.contentWindow) return;
      latest.current.onMessage?.({ data: e.data, targetOrigin: e.origin });
    };
    window.addEventListener("message", onMessage);
    latest.current.onReady?.();
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const s = h.props.style;
  if (!p.transparent) s.colorScheme = "normal";
  return h.wrap(createElement("div", h.props, createElement("iframe", {
    ref: frame,
    src: p.html ? undefined : p.url,
    srcDoc: p.html,
    allow: p.microphone ? "microphone; clipboard-read; clipboard-write; autoplay; fullscreen" : "clipboard-read; clipboard-write; autoplay; fullscreen",
    style: { background: p.transparent ? "transparent" : undefined, borderRadius: s.borderRadius },
    onLoad: (e: React.SyntheticEvent<HTMLIFrameElement>) => {
      const q = latest.current;
      let url = q.url ?? "about:srcdoc";
      try { url = e.currentTarget.contentWindow?.location.href ?? url; } catch {}
      q.onLoad?.({ phase: "finished", url });
      try {
        const title = e.currentTarget.contentDocument?.title;
        if (title) q.onTitle?.(title);
      } catch {}
    },
  })));
}

/** The main window fills the page; every other window kind has no place in a browser tab and renders nothing. */
export function Window(p: WindowProps) {
  const isMain = !p.kind || p.kind === "main";
  const latest = useRef(p);
  latest.current = p;
  useLayoutEffect(() => {
    if (!isMain) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const chord = matchChord(latest.current.keys, e);
      if (!chord) return;
      e.preventDefault();
      latest.current.onKey?.({ key: e.key, chord, mods: modsOf(e) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMain]);
  useLayoutEffect(() => {
    if (isMain && p.title) document.title = p.title;
  }, [isMain, p.title]);
  if (!isMain) return null;
  const style: Css = {};
  const bg = p.bg ?? p.fill;
  if (bg) style.backgroundColor = bg;
  return createElement("div", { className: "r win", style, dir: p.dir, "data-window": p.id }, p.children);
}
