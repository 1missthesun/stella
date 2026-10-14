import { parseColor } from "./color";
import type { Theme, ThemeColors } from "./types";

const REQUIRED_COLOR_KEYS = [
  "background",
  "backgroundWeak",
  "backgroundStrong",
  "foreground",
  "foregroundWeak",
  "foregroundStrong",
  "primary",
  "primaryForeground",
  "success",
  "warning",
  "error",
  "info",
  "interactive",
  "border",
  "borderWeak",
  "borderStrong",
  "card",
  "cardForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
] as const satisfies readonly Exclude<keyof ThemeColors, "gradientAnchor">[];

type ColorKey = keyof ThemeColors;
const COLOR_KEYS: readonly ColorKey[] = [...REQUIRED_COLOR_KEYS, "gradientAnchor"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isColor = (value: unknown): value is string =>
  typeof value === "string" && parseColor(value) !== null;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const parseColors = (value: unknown): ThemeColors | null => {
  if (!isRecord(value)) return null;
  const colors: Partial<ThemeColors> = {};
  for (const key of REQUIRED_COLOR_KEYS) {
    const color = value[key];
    if (!isColor(color)) return null;
    colors[key] = color;
  }
  if (value.gradientAnchor !== undefined) {
    if (!isColor(value.gradientAnchor)) return null;
    colors.gradientAnchor = value.gradientAnchor;
  }
  return colors as ThemeColors;
};

const parsePartialColors = (value: unknown): Partial<ThemeColors> | null => {
  if (!isRecord(value)) return null;
  const colors: Partial<ThemeColors> = {};
  for (const key of COLOR_KEYS) {
    const color = value[key];
    if (color === undefined) continue;
    if (!isColor(color)) return null;
    colors[key] = color;
  }
  return colors;
};

export const parseTheme = (value: unknown): Theme | null => {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const name = nonEmptyString(value.name);
  const light = parseColors(value.light);
  const dark = parseColors(value.dark);
  if (!id || !name || !light || !dark) return null;
  const theme: Theme = { id, name, light, dark };

  if (value.forcedMode !== undefined) {
    if (value.forcedMode !== "light" && value.forcedMode !== "dark") return null;
    theme.forcedMode = value.forcedMode;
  }
  if (value.flat !== undefined) {
    if (typeof value.flat !== "boolean") return null;
    theme.flat = value.flat;
  }
  if (value.populated !== undefined) {
    if (typeof value.populated !== "boolean") return null;
    theme.populated = value.populated;
  }
  if (value.base !== undefined) {
    const base = nonEmptyString(value.base);
    if (!base) return null;
    theme.base = base;
  }
  if (value.overrides !== undefined) {
    if (!isRecord(value.overrides)) return null;
    const overrides: NonNullable<Theme["overrides"]> = {};
    for (const mode of ["light", "dark"] as const) {
      if (value.overrides[mode] === undefined) continue;
      const parsed = parsePartialColors(value.overrides[mode]);
      if (!parsed) return null;
      overrides[mode] = parsed;
    }
    theme.overrides = overrides;
  }
  return theme;
};
