import { T } from "../kit/compat";
import { UsagePanel } from "./UsageTable";
import { useUsage } from "./usage.styles";
import { useTokens } from "../theme";
import { memo, useMemo, useState } from "react";
import type { UsageTimelinePoint } from "@/app/usage/usage-data";
import { useT } from "@/shared/i18n";
import { formatCost, formatTokens } from "@/app/usage/format";

const MARGIN_TOP = 10;
const MARGIN_RIGHT = 8;
const LEFT_AXIS_W = 58;
const RIGHT_AXIS_W = 54;
const X_AXIS_H = 30;
const LEGEND_H = 24;
const TICK_GAP = 8;
const MIN_TICK_GAP = 24;
const TICK_COUNT = 5;
const TICK_CHAR_W = 5.6;

/** Recharts' `getNiceTickValues([0, max], 5)`: five evenly stepped ticks from zero. */
function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1, 2, 3, 4];
  const stepFor = (rough: number, correction: number) => {
    const digits = Math.floor(Math.log10(Math.abs(rough))) + 1;
    const unit = 10 ** digits;
    const scale = digits !== 1 ? 0.05 : 0.1;
    return (Math.ceil(rough / unit / scale) + correction) * scale * unit;
  };
  let correction = 0;
  let step = stepFor(max / (TICK_COUNT - 1), correction);
  while (Math.ceil(max / step) + 1 > TICK_COUNT) step = stepFor(max / (TICK_COUNT - 1), ++correction);
  return Array.from({ length: TICK_COUNT }, (_, i) => +(i * step).toPrecision(12));
}

/** Recharts' `interval="preserveEnd"` with `minTickGap`: walk back from the last label, keeping each that clears the one after it. */
function visibleXTicks(labels: string[], xs: number[]): number[] {
  const kept: number[] = [];
  let edge = Infinity;
  for (let i = labels.length - 1; i >= 0; i--) {
    const half = (labels[i].length * TICK_CHAR_W) / 2;
    if (xs[i] + half + MIN_TICK_GAP <= edge || kept.length === 0) {
      kept.unshift(i);
      edge = xs[i] - half;
    }
  }
  return kept;
}

type Point = [number, number];

const sign = (v: number) => (v < 0 ? -1 : 1);

/** d3's `curveMonotoneX`, which Recharts' `type="monotone"` draws: cubic segments whose tangents never overshoot the points. */
function monotonePath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  if (n === 2) return `M${points[0][0]},${points[0][1]}L${points[1][0]},${points[1][1]}`;
  const slope = (i: number) => {
    const h = points[i + 1][0] - points[i][0];
    return h === 0 ? 0 : (points[i + 1][1] - points[i][1]) / h;
  };
  const tangents: number[] = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = points[i][0] - points[i - 1][0];
    const h1 = points[i + 1][0] - points[i][0];
    const s0 = slope(i - 1);
    const s1 = slope(i);
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    tangents[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const endTangent = (a: number, b: number, inner: number) => {
    const h = points[b][0] - points[a][0];
    return h === 0 ? inner : (3 * (points[b][1] - points[a][1])) / h / 2 - inner / 2;
  };
  tangents[0] = endTangent(0, 1, tangents[1]);
  tangents[n - 1] = endTangent(n - 2, n - 1, tangents[n - 2]);
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${x0 + dx},${y0 + dx * tangents[i]},${x1 - dx},${y1 - dx * tangents[i + 1]},${x1},${y1}`;
  }
  return d;
}

const svgColor = (color: string, attr: "fill" | "stroke" | "stop-color") => {
  const m = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) return `${attr}="${color}"`;
  const opacity = attr === "stop-color" ? "stop-opacity" : `${attr}-opacity`;
  return `${attr}="#${m[1]}"${m[2] ? ` ${opacity}="${(parseInt(m[2], 16) / 255).toFixed(3)}"` : ""}`;
};

/** Recharts' `legendType="line"` icon: a line through a hollow circle. */
const legendIcon = (color: string) =>
  `<path ${svgColor(color, "stroke")} stroke-width="4" fill="none" d="M0,16h10.667A5.333,5.333,0,1,1,21.333,16H32M21.333,16A5.333,5.333,0,1,1,10.667,16"/>`;

export const UsageTimelineChart = memo(function UsageTimelineChart({ timeline, height }: { timeline: UsageTimelinePoint[]; height: number }) {
  const s = useUsage();
  const t = useT();
  const tokens = useTokens();
  const c = tokens.c;
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const plot = useMemo(() => {
    const innerW = Math.max(0, width);
    const innerH = height;
    const left = LEFT_AXIS_W;
    const right = innerW - MARGIN_RIGHT - RIGHT_AXIS_W;
    const top = MARGIN_TOP;
    const bottom = innerH - LEGEND_H - X_AXIS_H;
    const plotW = Math.max(1, right - left);
    const plotH = Math.max(1, bottom - top);
    const costTicks = niceTicks(Math.max(0, ...timeline.map((p) => p.totalCostUsd)));
    const tokenTicks = niceTicks(Math.max(0, ...timeline.map((p) => p.totalTokens)));
    const costMax = costTicks[costTicks.length - 1] || 1;
    const tokenMax = tokenTicks[tokenTicks.length - 1] || 1;
    const n = timeline.length;
    const xs = timeline.map((_, i) => left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1)));
    const yCost = (v: number) => bottom - (v / costMax) * plotH;
    const yTokens = (v: number) => bottom - (v / tokenMax) * plotH;
    return { innerW, innerH, left, right, top, bottom, plotW, plotH, costTicks, tokenTicks, xs, yCost, yTokens };
  }, [timeline, width, height]);

  const svg = useMemo(() => {
    if (plot.innerW <= 0) return "";
    const { xs, yCost, yTokens, left, right, bottom, costTicks } = plot;
    const grid = costTicks.map((v) => `<line x1="${left}" x2="${right}" y1="${yCost(v)}" y2="${yCost(v)}" ${svgColor(c.borderWeak, "stroke")}/>`).join("");
    const costPath = monotonePath(timeline.map((p, i): Point => [xs[i], yCost(p.totalCostUsd)]));
    const tokenPath = monotonePath(timeline.map((p, i): Point => [xs[i], yTokens(p.totalTokens)]));
    const area = costPath ? `<path d="${costPath}L${xs[xs.length - 1]},${bottom}L${xs[0]},${bottom}Z" fill="url(#usageCostFill)"/>` : "";
    const costLine = costPath ? `<path d="${costPath}" fill="none" ${svgColor(c.primary, "stroke")} stroke-width="2"/>` : "";
    const tokenLine = tokenPath ? `<path d="${tokenPath}" fill="none" ${svgColor(c.foreground, "stroke")} stroke-width="1.5"/>` : "";
    const cursor = active !== null && xs[active] !== undefined ? `<line x1="${xs[active]}" x2="${xs[active]}" y1="${plot.top}" y2="${bottom}" stroke="#cccccc"/>` : "";
    const dots =
      active !== null && timeline[active]
        ? `<circle cx="${xs[active]}" cy="${yCost(timeline[active].totalCostUsd)}" r="4" ${svgColor(c.primary, "fill")} stroke="#fff" stroke-width="2"/><circle cx="${xs[active]}" cy="${yTokens(timeline[active].totalTokens)}" r="4" ${svgColor(c.foreground, "fill")} stroke="#fff" stroke-width="2"/>`
        : "";
    const gradient = `<defs><linearGradient id="usageCostFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" ${svgColor(c.primary, "stop-color")} stop-opacity="0.28"/><stop offset="95%" ${svgColor(c.primary, "stop-color")} stop-opacity="0.01"/></linearGradient></defs>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${plot.innerW}" height="${plot.innerH}" viewBox="0 0 ${plot.innerW} ${plot.innerH}">${gradient}${grid}${cursor}${area}${costLine}${tokenLine}${dots}</svg>`;
  }, [plot, timeline, active, c.primary, c.borderWeak, c.foreground]);

  const xTicks = useMemo(() => visibleXTicks(timeline.map((p) => p.label), plot.xs), [timeline, plot.xs]);
  const point = active !== null ? timeline[active] : undefined;
  const tick = { ...s.usageChartTick, nowrap: true } as const;

  return (
    <UsagePanel title={t("app.usage.timeline.title")} afterSummary>
      <col w="full" {...s.usageChart} role="img" label={t("app.usage.timeline.chartLabel")} onSize={(r) => setWidth(r.w)}>
        {svg ? (
          <col w={plot.innerW} h={plot.innerH}>
            <image absolute={{ left: 0, top: 0 }} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} w={plot.innerW} h={plot.innerH} inert />
            {plot.costTicks.map((v) => (
              <T key={`c${v}`} {...tick} absolute={{ left: 0, top: plot.yCost(v) - 6 }} w={plot.left - TICK_GAP} textAlign="end">
                {formatCost(v)}
              </T>
            ))}
            {plot.tokenTicks.map((v) => (
              <T key={`t${v}`} {...tick} absolute={{ left: plot.right + TICK_GAP, top: plot.yTokens(v) - 6 }} w={RIGHT_AXIS_W - TICK_GAP}>
                {formatTokens(v)}
              </T>
            ))}
            {xTicks.map((i) => (
              <T key={`x${i}`} {...tick} absolute={{ left: plot.xs[i] - 60, top: plot.bottom + TICK_GAP }} w={120} textAlign="center">
                {timeline[i].label}
              </T>
            ))}
            <row absolute={{ left: plot.left, top: plot.top }} w={plot.plotW} h={plot.plotH} onHover={(inside) => !inside && setActive(null)}>
              {timeline.map((p, i) => (
                <box key={p.label + i} grow={1} shrink minW={0} w={0} h="full" onHover={(inside) => inside && setActive(i)} />
              ))}
            </row>
            <row absolute={{ left: 0, top: plot.innerH - LEGEND_H }} w={plot.innerW - MARGIN_RIGHT} h={LEGEND_H} justify="center" gap={10}>
              {[
                { label: t("app.usage.timeline.series.cost"), color: c.primary },
                { label: t("app.usage.timeline.series.tokens"), color: c.foreground },
              ].map((item) => (
                <row key={item.label} align="center" gap={4}>
                  <icon svg={legendIcon(item.color)} name={`usage/legend-${item.color}`} view={32} size={14} inert />
                  <T size={16} lh={1.5} em={-0.01} color={item.color}>{item.label}</T>
                </row>
              ))}
            </row>
            {point && active !== null ? (
              <col {...s.usageChartTooltip} absolute={{ left: Math.min(plot.xs[active] + 10, plot.innerW - 170), top: plot.top + 10 }} raise inert>
                <T {...s.usageChartTooltipTitle}>{point.label}</T>
                <T {...s.usageChartTooltipText}>
                  {t("app.usage.timeline.tooltip.estimated", { value: formatCost(point.totalCostUsd) })}
                </T>
                <T {...s.usageChartTooltipText}>
                  {t("app.usage.timeline.tooltip.tokens", { value: formatTokens(point.totalTokens) })}
                </T>
                <T {...s.usageChartTooltipText}>
                  {t("app.usage.timeline.tooltip.calls", { count: point.calls })}
                </T>
              </col>
            ) : null}
          </col>
        ) : null}
      </col>
    </UsagePanel>
  );
});
