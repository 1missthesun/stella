// The value axis every platform's `<Chart>` draws (desktop and web ui/views/ViewChart.tsx, mobile
// src/views/ViewChart.tsx), so a chart reads the same everywhere.

/** Steps an axis may use, per power of ten. */
const STEPS = [1, 2, 2.5, 5];
/** Most intervals an axis draws; the tightest nice step within this wins. */
const MAX_INTERVALS = 5;

const clean = (v: number) => Number.parseFloat(v.toPrecision(12));

/**
 * Nice ticks from the first at or below `min` to the last at or above `max`: the smallest round
 * step (1, 2, 2.5 or 5 × 10ⁿ) that covers the data in at most five intervals, so the axis ends at
 * the first round value past the data rather than a whole step or two beyond it.
 */
export function niceTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    if (lo === 0) return [0, 1];
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  const span = hi - lo;
  const exp = Math.floor(Math.log10(span / MAX_INTERVALS));
  for (let e = exp; e <= exp + 2; e++) {
    for (const m of STEPS) {
      const step = m * 10 ** e;
      const first = Math.floor(clean(lo / step));
      const last = Math.ceil(clean(hi / step));
      if (last - first > MAX_INTERVALS) continue;
      const ticks: number[] = [];
      for (let i = first; i <= last; i++) ticks.push(clean(i * step));
      return ticks;
    }
  }
  return [lo, hi];
}

/**
 * The range a chart's value axis spans for `values` (each series' values, stacked totals
 * included): from zero unless the data sits well away from it (a line or scatter of 95…105 keeps
 * its detail), to the data's extremes, then out to nice ticks.
 */
export function chartAxis(values: readonly number[], options: { fromZero: boolean }): { ticks: number[]; min: number; max: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { ticks: [0, 1], min: 0, max: 1 };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (options.fromZero || (lo > 0 && lo < hi * 0.5)) lo = Math.min(lo, 0);
  if (options.fromZero || (hi < 0 && hi > lo * 0.5)) hi = Math.max(hi, 0);
  const ticks = niceTicks(lo, hi);
  return { ticks, min: ticks[0]!, max: ticks[ticks.length - 1]! };
}
