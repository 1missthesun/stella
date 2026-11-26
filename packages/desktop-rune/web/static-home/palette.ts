import { mixOklch } from "../../ui/theme/color";
import type { Gradient, Tokens } from "../../ui/theme/tokens";

export const STATIC_HOME_LOOK_KEY = "stella:rune-static-home";

export type StaticHomeLook = { dark: boolean; vars: Record<string, string> };

const gradientCss = (g: Gradient) => `linear-gradient(${g.angle}deg, ${g.stops.map(([at, color]) => `${color} ${Math.round(at * 10000) / 100}%`).join(", ")})`;

/** The home's colours as the pre-rendered home's CSS variables (ui/shell/home and chat/Composer's looks). */
export function staticHomeLook(t: Tokens): StaticHomeLook {
  const c = t.c;
  return {
    dark: t.dark,
    vars: {
      "--sh-bg": c.background,
      "--sh-title": c.textStrong,
      "--sh-panel": gradientCss(t.gradient.panel),
      "--sh-border": c.panelSurfaceBorder,
      "--sh-focus": mixOklch(c.primary, 18, c.border),
      "--sh-hl": c.panelSurfaceHighlight,
      "--sh-add": mixOklch(c.foreground, 6, "transparent"),
      "--sh-add-icon": c.textWeak,
      "--sh-mic": c.textBase,
      "--sh-primary": c.primary,
      "--sh-on-primary": c.primaryForeground,
      "--sh-text": c.textStrong,
      "--sh-ph": c.textWeaker,
    },
  };
}
