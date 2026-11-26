import type { CSSProperties } from "react";
import type { BoxProps, Effect, Gradient, Loop, Presence, Radial, Shadow, Size, TextProps } from "../../host/rune-jsx/props";
import { ensureRule, hash } from "./sheet";

export type Css = CSSProperties & Record<`--${string}`, string | number | undefined>;

const px = (v: number) => `${v}px`;

export function size(v: Size | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return px(v);
  if (v === "full") return "100%";
  if (v === "fit") return "fit-content";
  return v;
}

const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", auto: "auto" };
const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" };

const CURSORS: Record<string, string> = {
  default: "default", pointer: "pointer", text: "text", grab: "grab", grabbing: "grabbing", notAllowed: "not-allowed", "not-allowed": "not-allowed",
  move: "move", colResize: "col-resize", rowResize: "row-resize", ewResize: "ew-resize", nsResize: "ns-resize", nwseResize: "nwse-resize", neswResize: "nesw-resize",
};

export function gradientCss(g: Gradient): string {
  const stops = g.stops.map(([t, c]) => `${c} ${Math.round(t * 10000) / 100}%`).join(", ");
  return `linear-gradient(${g.angle ?? 180}deg, ${stops})`;
}

function radialCss(r: Radial): string {
  const [cx, cy] = r.center ?? [0.5, 0.5];
  const [rx, ry] = Array.isArray(r.radius) ? r.radius : [r.radius, r.radius];
  const stops = r.stops.map(([t, c]) => `${c} ${Math.round(t * 10000) / 100}%`).join(", ");
  return `radial-gradient(${px(rx)} ${px(ry)} at ${cx * 100}% ${cy * 100}%, ${stops})`;
}

const shadowCss = (s: Shadow) => `${s.inset ? "inset " : ""}${px(s.x ?? 0)} ${px(s.y ?? 0)} ${px(s.blur ?? 0)} ${px(s.spread ?? 0)} ${s.color}`;

function borderLayers(p: BoxProps): string[] {
  if (!p.border) return [];
  const color = "var(--rbc, var(--rb0))";
  if (p.borderSides) {
    const [t, r, b, l] = p.borderSides;
    const out: string[] = [];
    if (t > 0) out.push(`inset 0 ${px(t)} 0 0 ${color}`);
    if (r > 0) out.push(`inset ${px(-r)} 0 0 0 ${color}`);
    if (b > 0) out.push(`inset 0 ${px(-b)} 0 0 ${color}`);
    if (l > 0) out.push(`inset ${px(l)} 0 0 0 ${color}`);
    return out;
  }
  if (p.borderDash) return [];
  return [`inset 0 0 0 ${px(p.borderWidth ?? 1)} ${color}`];
}

export function transformCss(p: { x?: number; y?: number; scale?: number; rotate?: number }): string | undefined {
  const parts: string[] = [];
  if (p.x || p.y) parts.push(`translate(${px(p.x ?? 0)}, ${px(p.y ?? 0)})`);
  if (p.scale !== undefined && p.scale !== 1) parts.push(`scale(${p.scale})`);
  if (p.rotate) parts.push(`rotate(${p.rotate}rad)`);
  return parts.length ? parts.join(" ") : undefined;
}

export function springCurve(bounce = 0): string {
  if (bounce > 0.05) return `cubic-bezier(0.34, ${1 + Math.min(1, bounce) * 0.9}, 0.64, 1)`;
  return "cubic-bezier(0.22, 1, 0.36, 1)";
}

const TRANSITIONED = "transform, opacity, background-color, box-shadow, color, width, height, min-width, max-width, min-height, max-height, filter, border-radius, left, top, right, bottom, padding, margin";

function loopAnimation(l: Loop, base = ""): string | undefined {
  const pre = base ? `${base} ` : "";
  const period = Math.max(0.01, l.period);
  const iterations = l.times ? String(l.times) : "infinite";
  const delay = l.delay ? `${l.delay}s` : "0s";
  let name: string;
  if (l.kind === "rotation") {
    name = base ? `rl-r-${hash(base)}` : "rune-spin";
    if (base) ensureRule(name, `@keyframes ${name} { from { transform: ${pre}rotate(0deg); } to { transform: ${pre}rotate(360deg); } }`);
    return `${name} ${period}s linear ${delay} ${iterations}`;
  }
  if (l.kind === "opacity") {
    const low = l.low ?? 0.35;
    const high = l.high ?? 1;
    name = `rl-o-${hash(`${low}:${high}`)}`;
    ensureRule(name, `@keyframes ${name} { 0%, 100% { opacity: ${high}; } 50% { opacity: ${low}; } }`);
    return `${name} ${period}s ease-in-out ${delay} ${iterations}`;
  }
  if (l.kind === "slide") {
    const xy = (v: number | [number, number] | undefined) => (Array.isArray(v) ? v : [v ?? 0, 0]);
    const [fx, fy] = xy(l.from);
    const [tx, ty] = xy(l.to);
    name = `rl-s-${hash(`${pre}${fx}:${fy}:${tx}:${ty}`)}`;
    ensureRule(name, `@keyframes ${name} { from { transform: ${pre}translate(${px(fx)}, ${px(fy)}); } to { transform: ${pre}translate(${px(tx)}, ${px(ty)}); } }`);
    return `${name} ${period}s linear ${delay} ${iterations}`;
  }
  if (l.kind === "sequence" && l.frames && l.frames.length >= 2) {
    const fractions = l.frames.every((f) => f.at <= 1);
    const frames = l.frames.map((f) => {
      const at = fractions ? f.at : f.at / period;
      const scale = f.scale ?? (f.scaleX !== undefined || f.scaleY !== undefined ? undefined : 1);
      const sx = f.scaleX ?? scale ?? 1;
      const sy = f.scaleY ?? scale ?? 1;
      return `${Math.min(100, Math.max(0, at * 100)).toFixed(3)}% { opacity: ${f.opacity ?? 1}; transform: ${pre}translate(${px(f.x ?? 0)}, ${px(f.y ?? 0)}) scale(${sx}, ${sy}) rotate(${f.rotate ?? 0}rad); }`;
    });
    const body = frames.join(" ");
    name = `rl-q-${hash(body)}`;
    ensureRule(name, `@keyframes ${name} { ${body} }`);
    return `${name} ${period}s linear ${delay} ${iterations}`;
  }
  return undefined;
}

const PRESETS: Record<string, Effect> = {
  fade: { opacity: 0 },
  rise: { opacity: 0, y: 10 },
  drop: { opacity: 0, y: -8 },
  blur: { opacity: 0, blur: 8 },
  scale: { opacity: 0, scale: 0.96 },
  pop: { opacity: 0, scale: 0.9 },
  slide: { opacity: 0, x: 16 },
};

export const presenceEffect = (p: Presence): Effect => (typeof p === "string" ? (PRESETS[p] ?? PRESETS.fade!) : p);

const effectTransform = (e: Effect) => `translate(${px(e.x ?? 0)}, ${px(e.y ?? 0)}) scale(${e.scale ?? 1})`;

/** A keyframes animation from the presence effect to rest (enter), or the reverse (exit). */
export function presenceAnimation(p: Presence, direction: "enter" | "exit", base?: string): { animation: string; dur: number } {
  const e = presenceEffect(p);
  const dur = e.dur ?? 0.25;
  const from = `opacity: ${e.opacity ?? 1}; transform: ${base ? `${base} ` : ""}${effectTransform(e)};${e.blur ? ` filter: blur(${px(e.blur)});` : ""}`;
  const to = `opacity: 1; transform: ${base ?? "none"};${e.blur ? " filter: blur(0);" : ""}`;
  const name = `rp-${hash(from + to)}`;
  ensureRule(name, `@keyframes ${name} { from { ${from} } to { ${to} } }`);
  const curve = springCurve(e.bounce ?? 0);
  return { animation: `${name} ${dur}s ${curve} both${direction === "exit" ? " reverse" : ""}`, dur };
}

export type BoxStyle = { className: string; style: Css };

/** The CSS for the box props every element shares (host/ELEMENTS.md, "Common props"). */
export function boxStyle(p: BoxProps, base: string): BoxStyle {
  const cls: string[] = [base];
  const s: Css = {};
  if (p.w !== undefined) s.width = size(p.w);
  if (p.h !== undefined) s.height = size(p.h);
  if (p.minW !== undefined) s.minWidth = size(p.minW);
  if (p.maxW !== undefined) s.maxWidth = size(p.maxW);
  if (p.minH !== undefined) s.minHeight = size(p.minH);
  if (p.maxH !== undefined) s.maxHeight = size(p.maxH);
  if (p.grow !== undefined) s.flex = `${p.grow} 1 0%`;
  if (p.basis !== undefined) s.flexBasis = typeof p.basis === "number" ? px(p.basis) : p.basis;
  if (p.shrink) {
    s.flexShrink = 1;
    if (p.minW === undefined) s.minWidth = 0;
  }
  if (p.aspect) s.aspectRatio = String(p.aspect);
  const pt = p.pt ?? p.py ?? p.pad;
  const pr = p.pr ?? p.px ?? p.pad;
  const pb = p.pb ?? p.py ?? p.pad;
  const pl = p.pl ?? p.px ?? p.pad;
  if (pt) s.paddingTop = px(pt);
  if (pr) s.paddingRight = px(pr);
  if (pb) s.paddingBottom = px(pb);
  if (pl) s.paddingLeft = px(pl);
  const mt = p.mt ?? p.my;
  const mr = p.mr ?? p.mx;
  const mb = p.mb ?? p.my;
  const ml = p.ml ?? p.mx;
  if (mt) s.marginTop = px(mt);
  if (mr) s.marginRight = px(mr);
  if (mb) s.marginBottom = px(mb);
  if (ml) s.marginLeft = px(ml);
  if (p.gap !== undefined || p.rowGap !== undefined) {
    s.columnGap = px(p.gap ?? 0);
    s.rowGap = px(p.rowGap ?? p.gap ?? 0);
  }
  if (p.align) s.alignItems = ALIGN[p.align];
  if (p.justify) s.justifyContent = JUSTIFY[p.justify];
  if (p.selfAlign) s.alignSelf = ALIGN[p.selfAlign];
  if (p.center) {
    s.alignItems = "center";
    s.justifyContent = "center";
  }
  if (p.wrap) s.flexWrap = "wrap";
  if (p.columns) {
    s.display = "grid";
    s.gridTemplateColumns = `repeat(${Math.max(1, p.columns)}, minmax(0, 1fr))`;
  }
  if (p.column !== undefined) s.gridColumn = String(p.column + 1);
  const pin = p.absolute ?? (p.inset !== undefined ? { left: p.inset, top: p.inset, right: p.inset, bottom: p.inset } : undefined);
  if (pin) {
    s.position = p.fixed ? "fixed" : "absolute";
    if (pin.left !== undefined) s.left = px(pin.left);
    if (pin.top !== undefined) s.top = px(pin.top);
    if (pin.right !== undefined) s.right = px(pin.right);
    if (pin.bottom !== undefined) s.bottom = px(pin.bottom);
  } else if (p.fixed) {
    s.position = "fixed";
    s.inset = 0;
  }
  if (p.raise !== undefined && p.raise !== false) s.zIndex = p.raise === true ? 1 : p.raise;

  const layers: string[] = [];
  if (p.gradient) layers.push(gradientCss(p.gradient));
  else if (p.radial) layers.push(radialCss(p.radial));
  if (layers.length) s.backgroundImage = layers.join(", ");
  if (p.fill) s.backgroundColor = p.fill;
  if (p.corners) s.borderRadius = p.corners.map(px).join(" ");
  else if (p.radius) s.borderRadius = px(p.radius);
  if (p.clip !== undefined) {
    s.overflow = "hidden";
    if (p.clip > 0 && !p.radius && !p.corners) s.borderRadius = px(p.clip);
  }
  if (p.clipFade) {
    s.overflow = "hidden";
    const [l, t, r, b] = p.clipFade;
    const fade = (dir: string, a: number, z: number) => `linear-gradient(${dir}, ${a ? `transparent, #000 ${px(a)}` : "#000"}, ${z ? `#000 calc(100% - ${px(z)}), transparent` : "#000"})`;
    s.maskImage = `${fade("to right", l, r)}, ${fade("to bottom", t, b)}`;
    s.maskComposite = "intersect";
  }
  const shadows = borderLayers(p);
  if (p.border) s["--rb0"] = p.border;
  if (p.border && p.borderDash) {
    s.outline = `${px(p.borderWidth ?? 1)} dashed ${p.border}`;
    s.outlineOffset = px(-(p.borderWidth ?? 1));
  }
  if (p.shadows) shadows.push(...p.shadows.map(shadowCss));
  if (p.shadow) shadows.push(`0 ${px(p.shadow[0])} ${px(p.shadow[1])} 0 ${p.shadow[2]}`);
  if (shadows.length) {
    s.boxShadow = shadows.join(", ");
    s["--rsh"] = s.boxShadow;
  }
  if (p.opacity !== undefined && p.opacity !== 1) s.opacity = p.opacity;
  if (p.blur) s.filter = `blur(${px(p.blur)})`;
  if (p.backdropBlur) {
    s.backdropFilter = `blur(${px(p.backdropBlur)})`;
    s.WebkitBackdropFilter = s.backdropFilter;
  }

  const hoverFill = p.hoverFill ?? p.hover;
  const pressFill = p.pressFill ?? p.press;
  if (hoverFill && !p.disabled) { cls.push("hf"); s["--hf"] = hoverFill; }
  if (pressFill && !p.disabled) { cls.push("pf"); s["--pf"] = pressFill; }
  if (p.hoverBorder && !p.disabled) { cls.push("hb"); s["--hbc"] = p.hoverBorder; }
  if (p.pressBorder && !p.disabled) { cls.push("pb"); s["--pbc"] = p.pressBorder; }
  if (p.hoverGroup) cls.push("hg");
  if (p.hoverColor) { cls.push("hc"); s["--hc"] = p.hoverColor; }
  if (p.hoverOpacity) { cls.push("ho"); s["--ho0"] = p.hoverOpacity[0]; s["--ho1"] = p.hoverOpacity[1]; }
  if (p.pressScale && !p.disabled) { cls.push("ps"); s["--ps"] = p.pressScale; }
  if (p.focusRing) {
    cls.push("fr");
    s["--frw"] = px(p.focusRing.width ?? 2);
    s["--frc"] = p.focusRing.color;
    s["--fro"] = px(p.focusRing.offset ?? 0);
  }
  if (p.focusFill) { cls.push("ff"); s["--ff"] = p.focusFill; }
  if (p.focusBorder) { cls.push("fb"); s["--fbc"] = p.focusBorder; }
  if (p.disabled) cls.push("dis");
  if (p.hidden) cls.push("hid");

  const transform = transformCss(p);
  if (transform) {
    s.transform = transform;
    s["--rt"] = transform;
  }
  if (p.origin) s.transformOrigin = `${p.origin[0] * 100}% ${p.origin[1] * 100}%`;
  if (p.motion && !p.instant) {
    s.transition = `${TRANSITIONED}`.split(", ").map((prop) => `${prop} ${p.motion!.dur ?? 0.3}s ${springCurve(p.motion!.bounce ?? 0)}`).join(", ");
  } else if (p.layout && !p.instant) {
    s.transition = `width ${p.layout}s ${springCurve()}, height ${p.layout}s ${springCurve()}, transform ${p.layout}s ${springCurve()}`;
  }
  if (p.loop) {
    const anim = loopAnimation(p.loop, transform);
    if (anim) {
      s.animation = anim;
      if (p.loop.origin) s.transformOrigin = `${p.loop.origin[0] * 100}% ${p.loop.origin[1] * 100}%`;
    }
  }

  if (p.cursor) s.cursor = CURSORS[p.cursor] ?? p.cursor;
  if (p.inert) cls.push("inert");
  if (p.scrollY) cls.push("sy");
  if (p.scrollX) cls.push("sx");
  if (p.noScrollAnchor) cls.push("na");
  if (p.sticky) {
    s.position = "sticky";
    s[p.sticky] = px(p.stickyInset ?? 0);
    s.zIndex ??= 1;
  }
  if (p.selectionGroup) cls.push("sel");
  return { className: cls.join(" "), style: s };
}

const SYSTEM_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif`;

export const FAMILY = (p: Pick<TextProps, "mono" | "family">): string | undefined => {
  if (p.mono) return "var(--rune-mono)";
  if (!p.family) return undefined;
  if (p.family === "sans") return "var(--rune-sans)";
  if (p.family === "mono" || p.family === "system-mono") return "var(--rune-mono)";
  if (p.family === "System Font") return SYSTEM_STACK;
  return `"${p.family.replace(/"/g, "")}", var(--rune-sans)`;
};

/** Font, colour and wrapping for `<text>` and `<input>` (`style_of` + `apply` in engine/src/text.rs). */
export function textStyle(p: TextProps, s: Css): void {
  const sizePx = p.size ?? 13;
  s.fontSize = px(sizePx);
  s.fontWeight = p.weight ?? 400;
  s.lineHeight = px(p.lineHeight && p.lineHeight > 0 ? p.lineHeight : sizePx * 1.25);
  if (p.tracking) s.letterSpacing = px(p.tracking);
  const family = FAMILY(p);
  if (family) s.fontFamily = family;
  if (p.features) s.fontFeatureSettings = p.features;
  if (p.color) s.color = p.color;
  if (p.italic) s.fontStyle = "italic";
  if (p.underline || p.strike) s.textDecoration = [p.underline ? "underline" : "", p.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (p.textAlign) s.textAlign = p.textAlign === "end" ? "end" : p.textAlign;
  if (p.textCase) s.textTransform = p.textCase === "upper" ? "uppercase" : "lowercase";
}
