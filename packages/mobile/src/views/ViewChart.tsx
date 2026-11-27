import { useState } from "react";
import { View } from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import { Text } from "../components/Text";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { mix, type Paint } from "./view-style";

const fmt = (v: number, format?: string) => {
  if (format === "percent") return `${Math.round(v * 1000) / 10}%`;
  const abs = Math.abs(v);
  const short = abs >= 1e9 ? `${Math.round(v / 1e8) / 10}B` : abs >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : abs >= 1e4 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v * 100) / 100}`;
  return format === "currency" ? `$${short}` : short;
};

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? step0;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

type Shape = { d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };

export function ViewChart({ p, colors, paint }: { p: Record<string, unknown>; colors: Colors; paint: Paint }) {
  const [width, setWidth] = useState(340);
  const type = String(p.type ?? "line");
  const data = (Array.isArray(p.data) ? p.data : []) as Record<string, unknown>[];
  const xKey = String(p.x ?? "x");
  const series = (Array.isArray(p.y) ? p.y : [p.y]).filter((s): s is string => typeof s === "string");
  const height = typeof p.height === "number" ? p.height : 200;
  const base5 = [colors.accent, colors.ok, colors.warning, colors.danger, "#bf5af2"];
  const palette = Array.isArray(p.colors) && p.colors.length ? (p.colors as string[]).map((c) => paint(c) ?? c) : [...base5, ...base5.map((c) => mix(c, 55, colors.background))];
  const format = typeof p.format === "string" ? p.format : undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  const legend = (p.legend ?? series.length > 1) && type !== "pie";
  const title = typeof p.title === "string" ? p.title : null;
  const label = { fontFamily: fonts.sans.regular, fontSize: 12, color: colors.textMuted } as const;

  const header = (
    <>
      {title ? <Text style={{ fontFamily: fonts.sans.semiBold, fontSize: 16, color: colors.text }}>{title}</Text> : null}
      {legend ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {series.map((s, i) => (
            <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette[i % palette.length] }} />
              <Text style={label}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
  const onLayout = (w: number) => setWidth(Math.max(type === "pie" ? 120 : 160, Math.floor(w)));

  if (type === "pie") {
    const key = series[0] ?? "value";
    const total = data.reduce((sum, row) => sum + Math.max(0, num(row[key])), 0) || 1;
    const r = Math.min(height, width * 0.45) / 2 - 4;
    const cx = r + 4;
    const cy = r + 4;
    let angle = -Math.PI / 2;
    const slices = data.map((row, i) => {
      const share = Math.max(0, num(row[key])) / total;
      const a0 = angle;
      const a1 = angle + share * Math.PI * 2;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d =
        share >= 0.9999
          ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
          : `M${cx} ${cy}L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1 - 1e-6)} ${cy + r * Math.sin(a1 - 1e-6)}Z`;
      return <Path key={i} d={d} fill={palette[i % palette.length]} stroke={colors.background} strokeWidth={1.5} />;
    });
    return (
      <View style={{ alignSelf: "stretch", gap: 8 }} onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
        {header}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Svg width={cx * 2} height={cy * 2}>
            {slices}
          </Svg>
          <View style={{ flex: 1, gap: 6 }}>
            {data.map((row, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette[i % palette.length] }} />
                <Text style={[label, { fontSize: 13, color: colors.text, flex: 1 }]} numberOfLines={1}>
                  {String(row[xKey] ?? "")}
                </Text>
                <Text style={[label, { fontSize: 13, fontVariant: ["tabular-nums"] }]}>{`${Math.round((Math.max(0, num(row[key])) / total) * 100)}%`}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  const left = 40;
  const bottom = 20;
  const plotW = Math.max(40, width - left - 4);
  const plotH = Math.max(40, height - bottom - 6);
  const stacked = Boolean(p.stacked) && (type === "bar" || type === "area");
  let lo = 0;
  let hi = 0;
  const numericX = type === "scatter" || (data.length > 0 && data.every((row) => typeof row[xKey] === "number"));
  for (const row of data) {
    let acc = 0;
    for (const s of series) {
      const v = num(row[s]);
      acc += v;
      const top = stacked ? acc : v;
      lo = Math.min(lo, top, v);
      hi = Math.max(hi, top);
    }
  }
  if (type === "scatter" || type === "line") {
    const values = data.flatMap((row) => series.map((s) => num(row[s])));
    if (values.length) {
      lo = Math.min(...values);
      hi = Math.max(...values);
      if (lo > 0 && lo < hi * 0.5) lo = 0;
      const pad = (hi - lo) * 0.08 || 1;
      hi += pad;
      lo = lo === 0 ? 0 : lo - pad;
    }
  }
  const ticks = niceTicks(lo, hi === lo ? lo + 1 : hi);
  const yMin = ticks[0] ?? lo;
  const yMax = ticks[ticks.length - 1] ?? hi;
  const yOf = (v: number) => 6 + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const xs = data.map((row) => num(row[xKey]));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const band = plotW / Math.max(1, data.length);
  const xOf = (i: number) => (numericX && type !== "bar" ? left + ((xs[i]! - xMin) / (xMax - xMin || 1)) * plotW : left + band * i + band / 2);

  const shapes: Shape[] = [];
  for (const tick of ticks) shapes.push({ d: `M${left} ${yOf(tick)}H${left + plotW}`, stroke: colors.border, strokeWidth: 1 });
  const base = new Array<number>(data.length).fill(0);
  series.forEach((s, si) => {
    const color = palette[si % palette.length]!;
    if (type === "bar") {
      const groupW = band * 0.72;
      const w = stacked ? groupW : groupW / series.length;
      data.forEach((row, i) => {
        const v = num(row[s]);
        const x = left + band * i + (band - groupW) / 2 + (stacked ? 0 : w * si);
        const y0 = yOf(stacked ? base[i]! : 0);
        const y1 = yOf(stacked ? base[i]! + v : v);
        const top = Math.min(y0, y1);
        const h = Math.max(1, Math.abs(y1 - y0));
        const r = Math.min(3, w / 3, h / 2);
        shapes.push({ d: `M${x} ${top + h}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${top + h}Z`, fill: color });
        if (stacked) base[i]! += v;
      });
      return;
    }
    if (type === "scatter") {
      data.forEach((row, i) => {
        const x = xOf(i);
        const y = yOf(num(row[s]));
        shapes.push({ d: `M${x - 3.5} ${y}a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z`, fill: color, opacity: 0.85 });
      });
      return;
    }
    const pts = data.map((row, i) => [xOf(i), yOf(num(row[s]) + (stacked ? base[i]! : 0))] as const);
    if (!pts.length) return;
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join("");
    if (type === "area") {
      const floor = stacked
        ? data.map((_, i) => [xOf(i), yOf(base[i]!)] as const).reverse()
        : [[pts[pts.length - 1]![0], yOf(Math.max(yMin, 0))] as const, [pts[0]![0], yOf(Math.max(yMin, 0))] as const];
      shapes.push({ d: `${line}${floor.map(([x, y]) => `L${x} ${y}`).join("")}Z`, fill: color, opacity: stacked ? 0.85 : 0.18 });
      if (stacked) data.forEach((row, i) => (base[i]! += num(row[s])));
    }
    shapes.push({ d: line, stroke: color, strokeWidth: 2 });
  });

  const labelEvery = Math.max(1, Math.ceil((data.length * 44) / plotW));
  return (
    <View style={{ alignSelf: "stretch", gap: 8 }} onLayout={(e) => onLayout(e.nativeEvent.layout.width)}>
      {header}
      <Svg width={width} height={height}>
        {shapes.map((shape, i) => (
          <Path key={i} d={shape.d} fill={shape.fill ?? "none"} stroke={shape.stroke} strokeWidth={shape.strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={shape.opacity} />
        ))}
        {ticks.map((tick) => (
          <SvgText key={`y${tick}`} x={left - 6} y={yOf(tick) + 4} fontSize={11} fontFamily={fonts.sans.regular} fill={colors.textMuted} textAnchor="end">
            {fmt(tick, format)}
          </SvgText>
        ))}
        {data.map((row, i) =>
          i % labelEvery === 0 ? (
            <SvgText key={`x${i}`} x={xOf(i)} y={height - 5} fontSize={11} fontFamily={fonts.sans.regular} fill={colors.textMuted} textAnchor="middle">
              {typeof row[xKey] === "number" ? fmt(row[xKey] as number) : String(row[xKey] ?? "").slice(0, 10)}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}
