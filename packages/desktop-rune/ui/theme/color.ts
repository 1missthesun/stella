import { mixSrgbCss, parseColorOr, withAlpha } from "@stella/theme";
import { mixOklchCss } from "@stella/theme/color";

const byte = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");

/** Any CSS colour @stella/theme produces, as the engine's `#rrggbb` / `#rrggbbaa`. */
export function hex(css: string): string {
  const c = parseColorOr(css);
  const rgb = `#${byte(c.r)}${byte(c.g)}${byte(c.b)}`;
  return c.a >= 1 ? rgb : `${rgb}${byte(c.a * 255)}`;
}

/** `color-mix(in srgb, a pct%, b)`. */
export const mix = (a: string, pct: number, b: string) => hex(mixSrgbCss(a, pct, b));

/** `color-mix(in oklch, a pct%, b)`. */
export const mixOklch = (a: string, pct: number, b: string) => hex(mixOklchCss(a, pct, b));

export const alpha = (c: string, a: number) => hex(withAlpha(c, a));
