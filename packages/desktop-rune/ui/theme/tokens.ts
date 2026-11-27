import { deriveTokens, parseColorOr, THEME_CSS_VARS, type ThemeColors, type ThemeTokens } from "@stella/theme";
import { hex, mix } from "./color";

export type Shadow = { x: number; y: number; blur: number; spread?: number; color: string; inset?: boolean };
export type Gradient = { angle: number; stops: [number, string][] };

type ColorTokens = { [K in keyof ThemeTokens]: string } & {
  popover: string;
  popoverForeground: string;
  secondary: string;
  secondaryForeground: string;
  input: string;
  ring: string;
  interactiveForeground: string;
  destructiveForeground: string;
  danger: string;
  textMuted: string;
  surfaceBase: string;
  selectFillRaised: string;
  selectText: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  /** Opaque stops of `--overlay-surface-bg` (panel gradient over card over background). */
  overlayTop: string;
  overlayBottom: string;
  /** Opaque stops of `--glass-bg` (panel gradient over card). */
  glassTop: string;
  glassBottom: string;
  ghostHover: string;
  ghostPress: string;
  primaryHover: string;
  primaryPress: string;
  menuHighlight: string;
  scrim: string;
};

/** The system's accessibility display settings that change materials, and low-power hardware (`theme/accessibility.ts`). */
export type MaterialPrefs = {
  /** Reduce Transparency (or a contrast setting, which implies it) or low-power hardware: glass and translucent chrome draw as opaque surfaces. */
  solid: boolean;
  /** Increase Contrast or a high-contrast theme: those surfaces also get a stronger edge. */
  contrast: boolean;
};

export const GLASS_MATERIAL: MaterialPrefs = { solid: false, contrast: false };

export type Tokens = {
  themeId: string;
  dark: boolean;
  flat: boolean;
  material: MaterialPrefs;
  /** The theme's input colours, for what derives its own (gradient backdrop, previews). */
  colors: ThemeColors;
  c: ColorTokens;
  shadow: {
    subtle: Shadow[];
    sm: Shadow[];
    md: Shadow[];
    lg: Shadow[];
    xl: Shadow[];
    xsBorder: Shadow[];
    xsBorderFocus: Shadow[];
    overlay: Shadow[];
    overlayDrop: Shadow[];
    focusRing: Shadow[];
  };
  gradient: { overlay: Gradient; glass: Gradient; panel: Gradient; assistantBubble: Gradient };
  /** Every desktop-ui CSS custom property that is a colour, by its CSS name (`--text-strong`). */
  vars: Record<string, string>;
};

const s = (x: number, y: number, blur: number, color: string, spread = 0, inset = false): Shadow => ({ x, y, blur, spread, color: hex(color), inset });
const ring = (width: number, color: string): Shadow => s(0, 0, 0, color, width);

/** `fg` alpha-composited over an opaque-or-not `bg`. */
function over(fg: string, bg: string): string {
  const a = parseColorOr(fg);
  const b = parseColorOr(bg);
  const outA = a.a + b.a * (1 - a.a);
  if (outA <= 0) return "#00000000";
  const ch = (x: number, y: number) => (x * a.a + y * b.a * (1 - a.a)) / outA;
  return hex(`rgba(${ch(a.r, b.r)}, ${ch(a.g, b.g)}, ${ch(a.b, b.b)}, ${outA})`);
}

const vertical = (top: string, bottom: string): Gradient => ({ angle: 180, stops: [[0, top], [1, bottom]] });

const STATIC = {
  light: { chart: ["#0a84ff", "#34c759", "#ff9f0a", "#ff375f", "#bf5af2"] },
  dark: { chart: ["#0a84ff", "#30d158", "#ff9f0a", "#ff375f", "#bf5af2"] },
};

function shadows(dark: boolean, background: string, ringColor: string): Tokens["shadow"] {
  const focus = [ring(2, background), ring(4, ringColor)];
  if (dark) {
    return {
      subtle: [s(0, 1, 2, "rgba(0,0,0,0.3)")],
      sm: [s(0, 1, 2, "rgba(0,0,0,0.35)"), s(0, 1, 3, "rgba(0,0,0,0.3)")],
      md: [s(0, 1, 2, "rgba(0,0,0,0.4)"), s(0, 4, 12, "rgba(0,0,0,0.35)")],
      lg: [s(0, 2, 6, "rgba(0,0,0,0.45)"), s(0, 12, 32, "rgba(0,0,0,0.5)")],
      xl: [s(0, 4, 12, "rgba(0,0,0,0.5)"), s(0, 24, 56, "rgba(0,0,0,0.6)")],
      xsBorder: [ring(1, "rgba(255,255,255,0.08)"), s(0, 1, 2, "rgba(0,0,0,0.4)")],
      xsBorderFocus: [ring(1, "rgba(255,255,255,0.08)"), s(0, 1, 2, "rgba(0,0,0,0.4)"), ...focus],
      overlay: [ring(0.5, "rgba(0,0,0,0.5)"), s(0, 12, 36, "rgba(0,0,0,0.6)", -6)],
      overlayDrop: [s(0, 10, 24, "rgba(0,0,0,0.5)", -8)],
      focusRing: focus,
    };
  }
  return {
    subtle: [s(0, 1, 2, "rgba(0,0,0,0.04)")],
    sm: [s(0, 1, 2, "rgba(0,0,0,0.05)"), s(0, 1, 3, "rgba(0,0,0,0.05)")],
    md: [s(0, 1, 2, "rgba(0,0,0,0.05)"), s(0, 4, 12, "rgba(0,0,0,0.08)")],
    lg: [s(0, 2, 6, "rgba(0,0,0,0.06)"), s(0, 12, 32, "rgba(0,0,0,0.12)")],
    xl: [s(0, 4, 12, "rgba(0,0,0,0.08)"), s(0, 24, 56, "rgba(0,0,0,0.16)")],
    xsBorder: [ring(1, "rgba(0,0,0,0.08)"), s(0, 1, 2, "rgba(0,0,0,0.05)")],
    xsBorderFocus: [ring(1, "rgba(0,0,0,0.08)"), s(0, 1, 2, "rgba(0,0,0,0.05)"), ...focus],
    overlay: [ring(0.5, "rgba(0,0,0,0.06)"), s(0, 10, 30, "rgba(0,0,0,0.16)", -6)],
    overlayDrop: [s(0, 8, 22, "rgba(0,0,0,0.28)", -10)],
    focusRing: focus,
  };
}

const camelToVar = (k: string) => `--${k.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`)}`;

/** desktop-ui's whole token set for one theme, as `applyThemeToDocument` + index.css resolve it. */
export function buildTokens(input: { themeId: string; colors: ThemeColors; dark: boolean; flat: boolean; material?: MaterialPrefs }): Tokens {
  const { colors, dark, flat, themeId, material = GLASS_MATERIAL } = input;
  const raw = deriveTokens(colors, dark, { flat });
  const t = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, hex(v)])) as { [K in keyof ThemeTokens]: string };
  const chart = (dark ? STATIC.dark : STATIC.light).chart;
  const behindCard = over(t.card, t.background);
  const c: ColorTokens = {
    ...t,
    popover: t.card,
    popoverForeground: t.cardForeground,
    secondary: t.muted,
    secondaryForeground: t.foreground,
    input: t.border,
    ring: t.interactive,
    interactiveForeground: t.primaryForeground,
    destructiveForeground: t.primaryForeground,
    danger: t.destructive,
    textMuted: t.textWeak,
    surfaceBase: t.background,
    selectFillRaised: t.selectFill,
    selectText: t.textStrong,
    chart1: chart[0],
    chart2: chart[1],
    chart3: chart[2],
    chart4: chart[3],
    chart5: chart[4],
    overlayTop: over(t.panelSurfaceBgTop, behindCard),
    overlayBottom: over(t.panelSurfaceBgBottom, behindCard),
    glassTop: over(t.panelSurfaceBgTop, t.card),
    glassBottom: over(t.panelSurfaceBgBottom, t.card),
    ghostHover: mix(t.foreground, 6, "transparent"),
    ghostPress: mix(t.foreground, 10, "transparent"),
    primaryHover: mix(t.foreground, 10, t.primary),
    primaryPress: mix(t.foreground, 16, t.primary),
    menuHighlight: mix(t.foreground, 7, "transparent"),
    scrim: hex("rgba(0,0,0,0.35)"),
  };
  const vars: Record<string, string> = {};
  for (const [name, key] of THEME_CSS_VARS) vars[name] = t[key];
  for (const [k, v] of Object.entries(c)) if (!(camelToVar(k) in vars)) vars[camelToVar(k)] = v;
  vars["--interactive"] = c.ring;
  vars["--success"] = t.success;
  vars["--warning"] = t.warning;
  vars["--text-error"] = t.destructive;
  vars["--diff-add"] = t.success;
  vars["--diff-del"] = t.destructive;
  vars["--sidebar"] = t.background;
  vars["--sidebar-foreground"] = t.foreground;
  vars["--sidebar-primary"] = t.primary;
  vars["--sidebar-accent"] = t.muted;
  vars["--sidebar-border"] = t.border;
  return {
    themeId,
    dark,
    flat,
    material,
    colors,
    c,
    shadow: shadows(dark, t.background, c.ring),
    gradient: {
      overlay: vertical(c.overlayTop, c.overlayBottom),
      glass: vertical(c.glassTop, c.glassBottom),
      panel: vertical(t.panelSurfaceBgTop, t.panelSurfaceBgBottom),
      assistantBubble: vertical(t.chatAssistantBubbleFillTop, t.chatAssistantBubbleFillBottom),
    },
    vars,
  };
}

const derived = new WeakMap<Tokens, Map<string, unknown>>();

/** A value computed once per token set (a component's own colour mixes), not on every render. */
export function derive<T>(t: Tokens, key: string, make: (t: Tokens) => T): T {
  let m = derived.get(t);
  if (!m) derived.set(t, (m = new Map()));
  if (!m.has(key)) m.set(key, make(t));
  return m.get(key) as T;
}
