// A view's `<Canvas>`: its draw commands become vector paths (transforms baked into the points),
// with text and images laid over as Rune elements. Pointer input comes back in canvas points.
import { useState } from "react";
import { font, useTokens } from "../theme";
import type { Paint } from "./ViewRenderer";

type M = [number, number, number, number, number, number];
type Style = { fill?: string; stroke?: string; width?: number; opacity?: number; cap?: "butt" | "round" | "square"; radius?: number };
type Path = { d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; cap?: "round" | "butt" };
type Overlay = { kind: "text"; text: string; x: number; y: number; style: Record<string, unknown>; alpha: number } | { kind: "image"; src: string; x: number; y: number; w: number; h: number; alpha: number };

const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const r1 = (v: number) => Math.round(v * 10) / 10;
const isIdentity = (m: M) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function ellipsePoints(m: M, cx: number, cy: number, rx: number, ry: number): string {
  if (m[1] === 0 && m[2] === 0) {
    const [x, y] = apply(m, cx, cy);
    const a = Math.abs(rx * m[0]);
    const b = Math.abs(ry * m[3]);
    return `M${r1(x - a)} ${r1(y)}a${r1(a)} ${r1(b)} 0 1 0 ${r1(2 * a)} 0a${r1(a)} ${r1(b)} 0 1 0 ${r1(-2 * a)} 0Z`;
  }
  const n = 40;
  let d = "";
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const [x, y] = apply(m, cx + rx * Math.cos(t), cy + ry * Math.sin(t));
    d += `${i ? "L" : "M"}${r1(x)} ${r1(y)}`;
  }
  return `${d}Z`;
}

/** Applies `m` to absolute SVG path data (M L H V C S Q T Z, upper or lower case; arcs pass through when `m` only translates). */
function transformPath(d: string, m: M): string {
  if (isIdentity(m)) return d;
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gu) ?? [];
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let out = "";
  const next = () => Number(tokens[i++]);
  const pt = (x: number, y: number) => {
    const [a, b] = apply(m, x, y);
    return `${r1(a)} ${r1(b)}`;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/u.test(tokens[i]!)) cmd = tokens[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    if (C === "Z") {
      out += "Z";
      cx = sx;
      cy = sy;
      continue;
    }
    if (C === "M" || C === "L" || C === "T") {
      const x = next() + ox;
      const y = next() + oy;
      out += `${C === "M" ? "M" : C === "T" ? "T" : "L"}${pt(x, y)}`;
      if (C === "M") {
        sx = x;
        sy = y;
        cmd = rel ? "l" : "L";
      }
      cx = x;
      cy = y;
    } else if (C === "H" || C === "V") {
      const v = next();
      const x = C === "H" ? v + (rel ? cx : 0) : cx;
      const y = C === "V" ? v + (rel ? cy : 0) : cy;
      out += `L${pt(x, y)}`;
      cx = x;
      cy = y;
    } else if (C === "C") {
      const x1 = next() + ox, y1 = next() + oy, x2 = next() + ox, y2 = next() + oy, x = next() + ox, y = next() + oy;
      out += `C${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)}`;
      cx = x;
      cy = y;
    } else if (C === "S" || C === "Q") {
      const x1 = next() + ox, y1 = next() + oy, x = next() + ox, y = next() + oy;
      out += `${C}${pt(x1, y1)} ${pt(x, y)}`;
      cx = x;
      cy = y;
    } else if (C === "A") {
      const rx = next(), ry = next(), rot = next(), large = next(), sweep = next(), x = next() + ox, y = next() + oy;
      const s = scaleOf(m);
      out += `A${r1(rx * s)} ${r1(ry * s)} ${rot} ${large} ${sweep} ${pt(x, y)}`;
      cx = x;
      cy = y;
    } else {
      i++;
    }
  }
  return out;
}

function build(commands: unknown[], paint: Paint, w: number, h: number) {
  const paths: Path[] = [];
  const overlays: Overlay[] = [];
  let background: string | undefined;
  let m: M = [1, 0, 0, 1, 0, 0];
  let alpha = 1;
  const stack: { m: M; alpha: number }[] = [];
  const emit = (d: string, style: Style) => {
    const s = style ?? {};
    const opacity = (typeof s.opacity === "number" ? s.opacity : 1) * alpha;
    const fill = paint(s.fill);
    const stroke = paint(s.stroke);
    if (!fill && !stroke) {
      paths.push({ d, fill: paint("text"), ...(opacity < 1 ? { opacity } : {}) });
      return;
    }
    if (fill) paths.push({ d, fill, ...(opacity < 1 ? { opacity } : {}) });
    if (stroke) paths.push({ d, stroke, strokeWidth: (typeof s.width === "number" ? s.width : 1) * scaleOf(m), cap: s.cap === "round" ? "round" : "butt", ...(opacity < 1 ? { opacity } : {}) });
  };
  for (const raw of commands) {
    if (!Array.isArray(raw)) continue;
    const [op, ...a] = raw as [string, ...unknown[]];
    const n = (k: number) => (typeof a[k] === "number" ? (a[k] as number) : 0);
    switch (op) {
      case "clear":
        paths.length = 0;
        overlays.length = 0;
        background = paint(a[0]) ?? undefined;
        break;
      case "rect": {
        const [x, y, rw, rh] = [n(0), n(1), n(2), n(3)];
        const style = (a[4] ?? {}) as Style;
        const r = Math.min(typeof style.radius === "number" ? style.radius : 0, rw / 2, rh / 2);
        const d = r > 0 ? `M${x + r} ${y}H${x + rw - r}A${r} ${r} 0 0 1 ${x + rw} ${y + r}V${y + rh - r}A${r} ${r} 0 0 1 ${x + rw - r} ${y + rh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + rh - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z` : `M${x} ${y}H${x + rw}V${y + rh}H${x}Z`;
        emit(transformPath(d, m), style);
        break;
      }
      case "circle":
        emit(ellipsePoints(m, n(0), n(1), n(2), n(2)), (a[3] ?? {}) as Style);
        break;
      case "ellipse":
        emit(ellipsePoints(m, n(0), n(1), n(2), n(3)), (a[4] ?? {}) as Style);
        break;
      case "line":
        emit(`M${pt(m, n(0), n(1))}L${pt(m, n(2), n(3))}`, { stroke: "text", ...((a[4] ?? {}) as Style) });
        break;
      case "poly": {
        const pts = Array.isArray(a[0]) ? (a[0] as number[]) : [];
        let d = "";
        for (let i = 0; i + 1 < pts.length; i += 2) d += `${i ? "L" : "M"}${pt(m, pts[i]!, pts[i + 1]!)}`;
        if (d) emit(d, { stroke: "text", ...((a[1] ?? {}) as Style) });
        break;
      }
      case "path":
        emit(transformPath(String(a[0] ?? ""), m), (a[1] ?? {}) as Style);
        break;
      case "text": {
        const [x, y] = apply(m, n(1), n(2));
        overlays.push({ kind: "text", text: String(a[0] ?? ""), x, y, style: (a[3] ?? {}) as Record<string, unknown>, alpha });
        break;
      }
      case "image": {
        const [x, y] = apply(m, n(1), n(2));
        const s = scaleOf(m);
        overlays.push({ kind: "image", src: String(a[0] ?? ""), x, y, w: n(3) * s, h: n(4) * s, alpha });
        break;
      }
      case "save":
        stack.push({ m, alpha });
        break;
      case "restore": {
        const top = stack.pop();
        if (top) ({ m, alpha } = top);
        break;
      }
      case "translate":
        m = mul(m, [1, 0, 0, 1, n(0), n(1)]);
        break;
      case "rotate": {
        const c = Math.cos(n(0));
        const s = Math.sin(n(0));
        m = mul(m, [c, s, -s, c, 0, 0]);
        break;
      }
      case "scale":
        m = mul(m, [n(0), 0, 0, n(1), 0, 0]);
        break;
      case "alpha":
        alpha = Math.max(0, Math.min(1, n(0)));
        break;
      default:
        break;
    }
  }
  return { paths, overlays, background, w, h };
}

const pt = (m: M, x: number, y: number) => {
  const [a, b] = apply(m, x, y);
  return `${r1(a)} ${r1(b)}`;
};

export function ViewCanvas({ p, paint, onPointer }: { p: Record<string, unknown>; paint: Paint; onPointer?: (v: unknown) => void }) {
  const t = useTokens();
  const w = typeof p.width === "number" ? p.width : 300;
  const h = typeof p.height === "number" ? p.height : 150;
  const [shown, setShown] = useState(w);
  const scale = p.fit ? shown / w : 1;
  const scene = build(Array.isArray(p.commands) ? p.commands : [], paint, w, h);
  const fill = scene.background ?? paint(p.background);
  // Drag x/y are already in this element's own points.
  const toCanvas = (x: number, y: number) => ({ x: Math.round((x / scale) * 10) / 10, y: Math.round((y / scale) * 10) / 10 });
  return (
    <col
      w={p.fit ? "full" : w}
      {...(p.fit ? { aspect: w / h } : { h })}
      clip={0}
      {...(fill ? { fill } : {})}
      {...(p.fit ? { onLayout: (l: { w: number }) => setShown(l.w) } : {})}
      {...(onPointer
        ? {
            cursor: "crosshair",
            onDrag: (d: { phase: string; x: number; y: number }) => onPointer({ type: d.phase === "start" ? "down" : d.phase === "end" ? "up" : "move", ...toCanvas(d.x, d.y) }),
          }
        : {})}
    >
      <vector w={w * scale} h={h * scale} viewBox={[w, h]} paths={scene.paths} inert />
      {scene.overlays.map((o, i) => {
        if (o.kind === "image") return <image key={i} src={o.src} absolute={{ left: o.x * scale, top: o.y * scale }} w={o.w * scale} h={o.h * scale} fit="cover" opacity={o.alpha} inert />;
        const size = (typeof o.style.size === "number" ? o.style.size : 13) * scale;
        const align = o.style.align;
        const box = 400 * scale;
        const left = align === "center" ? o.x * scale - box / 2 : align === "end" ? o.x * scale - box : o.x * scale;
        return (
          <text
            key={i}
            absolute={{ left, top: o.y * scale - size * 0.82 }}
            w={box}
            size={size}
            lineHeight={size * 1.2}
            weight={typeof o.style.weight === "number" ? o.style.weight : 400}
            color={paint(o.style.color) ?? t.c.foreground}
            {...(o.style.mono ? { family: font.mono } : {})}
            textAlign={align === "center" ? "center" : align === "end" ? "end" : "start"}
            opacity={o.alpha}
            nowrap
            inert
          >
            {o.text}
          </text>
        );
      })}
    </col>
  );
}
