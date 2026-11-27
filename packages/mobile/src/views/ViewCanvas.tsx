import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { G, Image as SvgImage, Path, Text as SvgText } from "react-native-svg";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { familyFor, type Paint } from "./view-style";

type M = [number, number, number, number, number, number];
type Style = { fill?: string; stroke?: string; width?: number; opacity?: number; cap?: "butt" | "round" | "square"; radius?: number };
type Item =
  | { kind: "path"; d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; cap?: "butt" | "round" | "square" }
  | { kind: "text"; text: string; x: number; y: number; size: number; weight: number; mono: boolean; color: string; anchor: "start" | "middle" | "end"; opacity: number; matrix: M }
  | { kind: "image"; src: string; x: number; y: number; w: number; h: number; opacity: number; matrix: M };

const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const r1 = (v: number) => Math.round(v * 10) / 10;
const isIdentity = (m: M) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const pt = (m: M, x: number, y: number) => {
  const [a, b] = apply(m, x, y);
  return `${r1(a)} ${r1(b)}`;
};

function ellipsePath(m: M, cx: number, cy: number, rx: number, ry: number): string {
  if (m[1] === 0 && m[2] === 0) {
    const [x, y] = apply(m, cx, cy);
    const a = Math.abs(rx * m[0]);
    const b = Math.abs(ry * m[3]);
    return `M${r1(x - a)} ${r1(y)}a${r1(a)} ${r1(b)} 0 1 0 ${r1(2 * a)} 0a${r1(a)} ${r1(b)} 0 1 0 ${r1(-2 * a)} 0Z`;
  }
  let d = "";
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    d += `${i ? "L" : "M"}${pt(m, cx + rx * Math.cos(t), cy + ry * Math.sin(t))}`;
  }
  return `${d}Z`;
}

/** Applies `m` to SVG path data (M L H V C S Q T A Z, either case; arcs scale uniformly). */
function transformPath(d: string, m: M): string {
  if (isIdentity(m)) return d;
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gu) ?? [];
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let out = "";
  const next = () => Number(tokens[i++]);
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
      out += `${C}${pt(m, x, y)}`;
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
      out += `L${pt(m, x, y)}`;
      cx = x;
      cy = y;
    } else if (C === "C") {
      const x1 = next() + ox, y1 = next() + oy, x2 = next() + ox, y2 = next() + oy, x = next() + ox, y = next() + oy;
      out += `C${pt(m, x1, y1)} ${pt(m, x2, y2)} ${pt(m, x, y)}`;
      cx = x;
      cy = y;
    } else if (C === "S" || C === "Q") {
      const x1 = next() + ox, y1 = next() + oy, x = next() + ox, y = next() + oy;
      out += `${C}${pt(m, x1, y1)} ${pt(m, x, y)}`;
      cx = x;
      cy = y;
    } else if (C === "A") {
      const rx = next(), ry = next(), rot = next(), large = next(), sweep = next(), x = next() + ox, y = next() + oy;
      const s = scaleOf(m);
      out += `A${r1(rx * s)} ${r1(ry * s)} ${rot} ${large} ${sweep} ${pt(m, x, y)}`;
      cx = x;
      cy = y;
    } else {
      i++;
    }
  }
  return out;
}

function build(commands: unknown[], paint: Paint, colors: Colors) {
  const items: Item[] = [];
  let background: string | undefined;
  let m: M = IDENTITY;
  let alpha = 1;
  const stack: { m: M; alpha: number }[] = [];
  const emit = (d: string, style: Style) => {
    const s = style ?? {};
    const opacity = (typeof s.opacity === "number" ? s.opacity : 1) * alpha;
    const fill = paint(s.fill);
    const stroke = paint(s.stroke);
    const o = opacity < 1 ? { opacity } : {};
    if (!fill && !stroke) {
      items.push({ kind: "path", d, fill: colors.text, ...o });
      return;
    }
    if (fill) items.push({ kind: "path", d, fill, ...o });
    if (stroke) items.push({ kind: "path", d, stroke, strokeWidth: (typeof s.width === "number" ? s.width : 1) * scaleOf(m), cap: s.cap ?? "butt", ...o });
  };
  for (const raw of commands) {
    if (!Array.isArray(raw)) continue;
    const [op, ...a] = raw as [string, ...unknown[]];
    const n = (k: number) => (typeof a[k] === "number" ? (a[k] as number) : 0);
    switch (op) {
      case "clear":
        items.length = 0;
        background = paint(a[0]);
        break;
      case "rect": {
        const [x, y, rw, rh] = [n(0), n(1), n(2), n(3)];
        const style = (a[4] ?? {}) as Style;
        const r = Math.min(typeof style.radius === "number" ? style.radius : 0, rw / 2, rh / 2);
        const d =
          r > 0
            ? `M${x + r} ${y}H${x + rw - r}A${r} ${r} 0 0 1 ${x + rw} ${y + r}V${y + rh - r}A${r} ${r} 0 0 1 ${x + rw - r} ${y + rh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + rh - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
            : `M${x} ${y}H${x + rw}V${y + rh}H${x}Z`;
        emit(transformPath(d, m), style);
        break;
      }
      case "circle":
        emit(ellipsePath(m, n(0), n(1), n(2), n(2)), (a[3] ?? {}) as Style);
        break;
      case "ellipse":
        emit(ellipsePath(m, n(0), n(1), n(2), n(3)), (a[4] ?? {}) as Style);
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
        const style = (a[3] ?? {}) as Record<string, unknown>;
        items.push({
          kind: "text",
          text: String(a[0] ?? ""),
          x: n(1),
          y: n(2),
          size: typeof style.size === "number" ? style.size : 13,
          weight: typeof style.weight === "number" ? style.weight : 400,
          mono: Boolean(style.mono),
          color: paint(style.color) ?? colors.text,
          anchor: style.align === "center" ? "middle" : style.align === "end" ? "end" : "start",
          opacity: alpha,
          matrix: m,
        });
        break;
      }
      case "image":
        items.push({ kind: "image", src: String(a[0] ?? ""), x: n(1), y: n(2), w: n(3), h: n(4), opacity: alpha, matrix: m });
        break;
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
        m = mul(m, [n(0), 0, 0, typeof a[1] === "number" ? n(1) : n(0), 0, 0]);
        break;
      case "alpha":
        alpha = Math.max(0, Math.min(1, n(0)));
        break;
      default:
        break;
    }
  }
  return { items, background };
}

export function ViewCanvas({ p, colors, paint, onPointer }: { p: Record<string, unknown>; colors: Colors; paint: Paint; onPointer?: (v: unknown) => void }) {
  const w = typeof p.width === "number" && p.width > 0 ? p.width : 300;
  const h = typeof p.height === "number" && p.height > 0 ? p.height : 150;
  const [shown, setShown] = useState(w);
  const scale = p.fit ? shown / w : 1;
  const scene = useMemo(() => build(Array.isArray(p.commands) ? p.commands : [], paint, colors), [p.commands, paint, colors]);
  const fill = scene.background ?? paint(p.background);
  const handler = useRef(onPointer);
  handler.current = onPointer;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const gesture = useMemo(() => {
    const send = (type: "down" | "move" | "up", x: number, y: number) => handler.current?.({ type, x: r1(x / scaleRef.current), y: r1(y / scaleRef.current) });
    return Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => send("down", e.x, e.y))
      .onUpdate((e) => send("move", e.x, e.y))
      .onFinalize((e) => send("up", e.x, e.y));
  }, []);
  const svg = (
    <Svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} pointerEvents="none">
      {scene.items.map((item, i) => {
        if (item.kind === "path") {
          return <Path key={i} d={item.d} fill={item.fill ?? "none"} stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinecap={item.cap} strokeLinejoin="round" opacity={item.opacity} />;
        }
        const matrix = item.matrix;
        const transform = isIdentity(matrix) ? undefined : `matrix(${matrix.join(" ")})`;
        if (item.kind === "image") {
          return (
            <G key={i} transform={transform}>
              <SvgImage href={{ uri: item.src }} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="xMidYMid slice" opacity={item.opacity} />
            </G>
          );
        }
        return (
          <G key={i} transform={transform}>
            <SvgText x={item.x} y={item.y} fontSize={item.size} fontFamily={item.mono ? familyFor(item.weight, true) : item.weight >= 600 ? fonts.sans.semiBold : familyFor(item.weight)} fill={item.color} textAnchor={item.anchor} opacity={item.opacity}>
              {item.text}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
  const box = (
    <View
      style={{ width: p.fit ? "100%" : w, ...(p.fit ? { aspectRatio: w / h } : { height: h }), overflow: "hidden", ...(fill ? { backgroundColor: fill } : {}) }}
      onLayout={p.fit ? (e) => setShown(e.nativeEvent.layout.width) : undefined}
    >
      {svg}
    </View>
  );
  return onPointer ? <GestureDetector gesture={gesture}>{box}</GestureDetector> : box;
}
