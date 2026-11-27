import type { TextStyle, ViewStyle } from "react-native";
import { mixSrgbCss } from "@stella/theme";
import { oklchToHex } from "@stella/theme/color";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { VIEW_CENTRE_PROP } from "@stella/views/layout";

export type Paint = (value: unknown) => string | undefined;

/** "oklch(L C H / a)"; React Native's colour parser has no oklch. */
function oklchCss(value: string): string | null {
  const match = value.trim().match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/iu);
  if (!match) return null;
  const num = (token: string, percentOf: number) => (token.endsWith("%") ? (Number.parseFloat(token) / 100) * percentOf : Number.parseFloat(token));
  const hex = oklchToHex({ l: num(match[1]!, 1), c: num(match[2]!, 0.4), h: Number.parseFloat(match[3]!) });
  if (match[4] === undefined) return hex;
  const alpha = Math.max(0, Math.min(1, num(match[4], 1)));
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

export const mix = (a: string, pct: number, b: string) => mixSrgbCss(a, pct, b);

export function paintFor(c: Colors): Paint {
  const named: Record<string, string> = {
    text: c.text,
    muted: c.textMuted,
    accent: c.accent,
    danger: c.danger,
    success: c.ok,
    warning: c.warning,
    surface: c.card,
    subtle: mix(c.text, 5, c.background),
    border: c.border,
    background: c.background,
  };
  return (value) => {
    if (typeof value !== "string" || !value) return undefined;
    return named[value] ?? (value.toLowerCase().startsWith("oklch(") ? (oklchCss(value) ?? undefined) : value);
  };
}

export const RADIUS: Record<string, number> = { sm: 6, md: 10, lg: 14, xl: 20, full: 9999 };

type SizeValue = number | `${number}%`;

/** A view `Size` as a style value; "fit" is handled by the caller (it means "don't stretch"). */
export function sizeOf(value: unknown): SizeValue | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === "full") return "100%";
  if (typeof value === "string" && /^\d+(\.\d+)?%$/u.test(value)) return value as `${number}%`;
  return undefined;
}

const ALIGN: Record<string, ViewStyle["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch", baseline: "baseline" };
const JUSTIFY: Record<string, ViewStyle["justifyContent"]> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around", evenly: "space-evenly" };

const SHADOWS: Record<string, string> = {
  sm: "0px 1px 2px rgba(0,0,0,0.08)",
  md: "0px 4px 12px rgba(0,0,0,0.12)",
  lg: "0px 12px 32px rgba(0,0,0,0.18)",
};

export function radiusOf(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") return RADIUS[value];
  return undefined;
}

export function boxStyle(p: Record<string, unknown>, colors: Colors, paint: Paint): ViewStyle {
  const s: ViewStyle = {};
  if (typeof p.gap === "number") s.gap = p.gap;
  const pad = p.padding;
  if (typeof pad === "number") s.padding = pad;
  else if (Array.isArray(pad) && pad.length === 2) Object.assign(s, { paddingVertical: pad[0], paddingHorizontal: pad[1] });
  else if (Array.isArray(pad) && pad.length === 4) Object.assign(s, { paddingTop: pad[0], paddingRight: pad[1], paddingBottom: pad[2], paddingLeft: pad[3] });
  if (typeof p.align === "string" && ALIGN[p.align]) s.alignItems = ALIGN[p.align];
  if (typeof p.justify === "string" && JUSTIFY[p.justify]) s.justifyContent = JUSTIFY[p.justify];
  if (p.wrap) s.flexWrap = "wrap";
  if (typeof p.grow === "number") s.flexGrow = p.grow;
  if (typeof p.shrink === "number") s.flexShrink = p.shrink;
  else if (p.shrink === false) s.flexShrink = 0;
  for (const key of ["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    const v = sizeOf(p[key]);
    if (v !== undefined) s[key] = v;
  }
  if (p.width === "fit") s.alignSelf = "flex-start";
  // The view's content column, narrower than the surface: in the middle of it.
  if (p[VIEW_CENTRE_PROP] === true) s.alignSelf = "center";
  if (typeof p.aspect === "number" && p.aspect > 0) s.aspectRatio = p.aspect;
  const fill = paint(p.background);
  if (fill) s.backgroundColor = fill;
  const r = radiusOf(p.radius);
  if (r !== undefined) {
    s.borderRadius = r;
    s.overflow = "hidden";
  }
  if (p.border === true) {
    s.borderWidth = 1;
    s.borderColor = colors.border;
  } else if (typeof p.border === "string") {
    s.borderWidth = 1;
    s.borderColor = paint(p.border);
  }
  if (typeof p.shadow === "string" && SHADOWS[p.shadow]) {
    s.boxShadow = SHADOWS[p.shadow];
    if (r !== undefined) delete s.overflow;
  }
  if (typeof p.opacity === "number") s.opacity = p.opacity;
  if (p.hidden) s.display = "none";
  return s;
}

export const familyFor = (weight: number, mono = false) =>
  mono ? (weight >= 500 ? fonts.mono.medium : fonts.mono.regular) : weight >= 700 ? fonts.sans.bold : weight >= 600 ? fonts.sans.semiBold : weight >= 500 ? fonts.sans.medium : fonts.sans.regular;

type Variant = { size: number; weight: number; lineHeight: number; letterSpacing?: number; family?: string; muted?: boolean; mono?: boolean };

export const TEXT_VARIANTS: Record<string, Variant> = {
  display: { size: 34, weight: 600, lineHeight: 40, letterSpacing: -0.6, family: fonts.display.semiBold },
  title: { size: 28, weight: 600, lineHeight: 34, letterSpacing: -0.4, family: fonts.display.semiBold },
  heading: { size: 21, weight: 600, lineHeight: 27 },
  subheading: { size: 18, weight: 500, lineHeight: 25 },
  body: { size: 16, weight: 400, lineHeight: 23 },
  label: { size: 14, weight: 600, lineHeight: 20 },
  caption: { size: 13, weight: 400, lineHeight: 18, muted: true },
  mono: { size: 14, weight: 400, lineHeight: 21, mono: true },
};

export function variantStyle(name: unknown): { style: TextStyle; variant: Variant } {
  const variant = TEXT_VARIANTS[typeof name === "string" ? name : "body"] ?? TEXT_VARIANTS.body!;
  return {
    variant,
    style: {
      fontSize: variant.size,
      lineHeight: variant.lineHeight,
      fontFamily: variant.family ?? familyFor(variant.weight, variant.mono),
      ...(variant.letterSpacing !== undefined ? { letterSpacing: variant.letterSpacing } : {}),
    },
  };
}

export type Option = { value: string; label: string };

export const optionList = (options: unknown): Option[] =>
  Array.isArray(options)
    ? options.map((o) =>
        typeof o === "string"
          ? { value: o, label: o }
          : { value: String((o as { value: unknown }).value), label: String((o as { label?: unknown }).label ?? (o as { value: unknown }).value) },
      )
    : [];

export const textOf = (children: unknown[] | undefined) => (children ?? []).filter((c): c is string => typeof c === "string").join("");
