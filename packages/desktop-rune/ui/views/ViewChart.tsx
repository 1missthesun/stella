// A view's `<Chart>`: line, area, bar, pie and scatter, drawn as vector paths sized to the space
// it has, with axis labels as text and a legend for several series.
import { useState } from "react";
import { chartAxis } from "@stella/views/chart";
import { formatAxis } from "@stella/views/format";
import { fontSize, look, mix, useTokens } from "../theme";
import type { Paint } from "./ViewRenderer";

const LABEL = look(fontSize.xs, 400, { lh: 1.3 });
const TITLE = look(fontSize.md, 600, { lh: 1.4 });

export function ViewChart({ p, paint }: { p: Record<string, unknown>; paint: Paint }) {
  const t = useTokens();
  const [width, setWidth] = useState(360);
  const type = String(p.type ?? "line");
  const data = (Array.isArray(p.data) ? p.data : []) as Record<string, unknown>[];
  const xKey = String(p.x ?? "x");
  const series = (Array.isArray(p.y) ? p.y : [p.y]).filter((s): s is string => typeof s === "string");
  const height = typeof p.height === "number" ? p.height : 200;
  const palette = (Array.isArray(p.colors) && p.colors.length ? (p.colors as string[]).map((c) => paint(c) ?? c) : [t.c.chart1, t.c.chart2, t.c.chart3, t.c.chart4, t.c.chart5, ...[t.c.chart1, t.c.chart2, t.c.chart3, t.c.chart4, t.c.chart5].map((c) => mix(c, 55, t.c.background))]) as string[];
  const format = typeof p.format === "string" ? p.format : undefined;
  const fmt = (v: number, f?: string) => formatAxis(v, f, { currency: p.currency });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
  const legend = (p.legend ?? series.length > 1) && type !== "pie";
  const title = typeof p.title === "string" ? p.title : null;

  const header = (
    <>
      {title ? <text {...TITLE} color={t.c.foreground}>{title}</text> : null}
      {legend ? (
        <row gap={12} wrap>
          {series.map((s, i) => (
            <row key={s} gap={6} align="center">
              <box w={8} h={8} radius={4} fill={palette[i % palette.length]} />
              <text {...LABEL} color={t.c.textWeak}>{s}</text>
            </row>
          ))}
        </row>
      ) : null}
    </>
  );

  // No data: the plot's floor alone, with no axis to read (ticks of nothing would be made up).
  const empty = data.length === 0 || series.length === 0 || (type === "pie" && data.every((row) => !(num(row[series[0]!]) > 0)));
  if (empty) {
    return (
      <col w="full" gap={8} onLayout={(l: { w: number }) => setWidth(Math.max(120, l.w))}>
        {header}
        <col w="full" h={height}>
          <vector w={width} h={height} viewBox={[width, height]} paths={[{ d: `M0 ${height - 1}H${width}`, stroke: t.c.border, strokeWidth: 1 }]} />
        </col>
      </col>
    );
  }

  if (type === "pie") {
    const key = series[0] ?? "value";
    const total = data.reduce((sum, row) => sum + Math.max(0, num(row[key])), 0) || 1;
    const r = Math.min(height, width) / 2 - 4;
    const cx = r + 4;
    const cy = height / 2;
    let angle = -Math.PI / 2;
    const paths = data.map((row, i) => {
      const share = Math.max(0, num(row[key])) / total;
      const a0 = angle;
      const a1 = angle + share * Math.PI * 2;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0);
      const y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1 - 1e-6);
      const y1 = cy + r * Math.sin(a1 - 1e-6);
      return { d: share >= 0.9999 ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : `M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}Z`, fill: palette[i % palette.length], stroke: t.c.background, strokeWidth: 1.5 };
    });
    return (
      <col w="full" gap={8} onLayout={(l: { w: number }) => setWidth(Math.max(120, l.w))}>
        {header}
        <row gap={16} align="center">
          <vector w={cx * 2} h={height} viewBox={[cx * 2, height]} paths={paths} />
          <col gap={6} grow={1}>
            {data.map((row, i) => (
              <row key={i} gap={8} align="center">
                <box w={8} h={8} radius={4} fill={palette[i % palette.length]} />
                <text {...LABEL} size={fontSize.sm} color={t.c.foreground} grow={1}>{String(row[xKey] ?? "")}</text>
                <text {...LABEL} size={fontSize.sm} color={t.c.textWeak}>{`${Math.round((Math.max(0, num(row[key])) / total) * 100)}%`}</text>
              </row>
            ))}
          </col>
        </row>
      </col>
    );
  }

  const left = 40;
  const bottom = 20;
  const plotW = Math.max(40, width - left - 4);
  const plotH = Math.max(40, height - bottom - 6);
  const stacked = Boolean(p.stacked) && (type === "bar" || type === "area");
  const numericX = type === "scatter" || data.every((row) => typeof row[xKey] === "number");
  const values: number[] = [];
  for (const row of data) {
    let acc = 0;
    for (const s of series) {
      const v = num(row[s]);
      acc += v;
      values.push(v);
      if (stacked) values.push(acc);
    }
  }
  const { ticks, min: yMin, max: yMax } = chartAxis(values, { fromZero: type === "bar" || type === "area" });
  const yOf = (v: number) => 6 + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const xs = data.map((row) => num(row[xKey]));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const band = plotW / Math.max(1, data.length);
  const xOf = (i: number) => (numericX && type !== "bar" ? left + ((xs[i]! - xMin) / (xMax - xMin || 1)) * plotW : left + band * i + band / 2);

  const paths: { d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; cap?: "round" | "butt" }[] = [];
  for (const tick of ticks) paths.push({ d: `M${left} ${yOf(tick)}H${left + plotW}`, stroke: t.c.border, strokeWidth: 1 });
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
        paths.push({ d: `M${x} ${top + h}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + w - r}Q${x + w} ${top} ${x + w} ${top + r}V${top + h}Z`, fill: color });
        if (stacked) base[i]! += v;
      });
      return;
    }
    if (type === "scatter") {
      data.forEach((row, i) => {
        const x = xOf(i);
        const y = yOf(num(row[s]));
        paths.push({ d: `M${x - 3.5} ${y}a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z`, fill: color, opacity: 0.85 });
      });
      return;
    }
    const pts = data.map((row, i) => {
      const v = num(row[s]) + (stacked ? base[i]! : 0);
      return [xOf(i), yOf(v)] as const;
    });
    if (!pts.length) return;
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join("");
    if (type === "area") {
      const floor = stacked ? data.map((_, i) => [xOf(i), yOf(base[i]!)] as const).reverse() : [[pts[pts.length - 1]![0], yOf(Math.max(yMin, 0))] as const, [pts[0]![0], yOf(Math.max(yMin, 0))] as const];
      paths.push({ d: `${line}${floor.map(([x, y]) => `L${x} ${y}`).join("")}Z`, fill: color, opacity: stacked ? 0.85 : 0.18 });
      if (stacked) data.forEach((row, i) => (base[i]! += num(row[s])));
    }
    paths.push({ d: line, stroke: color, strokeWidth: 2, cap: "round" });
  });

  const labelEvery = Math.max(1, Math.ceil((data.length * 44) / plotW));
  return (
    <col w="full" gap={8} onLayout={(l: { w: number }) => setWidth(Math.max(160, l.w))}>
      {header}
      <col w="full" h={height}>
        <vector w={width} h={height} viewBox={[width, height]} paths={paths} />
        {ticks.map((tick) => (
          <text key={`y${tick}`} {...LABEL} color={t.c.textWeak} absolute={{ left: 0, top: yOf(tick) - 7 }} w={left - 6} textAlign="end" nowrap>
            {fmt(tick, format)}
          </text>
        ))}
        {data.map((row, i) =>
          i % labelEvery === 0 ? (
            <text key={`x${i}`} {...LABEL} color={t.c.textWeak} absolute={{ left: xOf(i) - 30, top: height - bottom + 4 }} w={60} textAlign="center" nowrap truncate>
              {typeof row[xKey] === "number" ? fmt(row[xKey] as number) : String(row[xKey] ?? "")}
            </text>
          ) : null,
        )}
      </col>
    </col>
  );
}
