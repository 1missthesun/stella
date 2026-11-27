import type { Effect, FxLayer } from "../../host/rune-jsx/props";
import { alpha, derive, mix, mixOklch, type Tokens } from "../theme";

/** Corner radius of a glass menu; its items are pills inset by the menu's padding. */
export const MENU_GLASS_RADIUS = 22;
/** Corner radius of a glass popover (free-form content rather than pill rows). */
export const POPOVER_GLASS_RADIUS = 18;

/**
 * Liquid Glass for menus and popovers, after the phone app's `regular` + `legible` glass
 * (`tintColor = fadeHex(surface, 0.78)`, packages/mobile glass.tsx): the composer's material under
 * a denser surface veil, so rows stay readable over any content. One glass element per menu,
 * anchored to its trigger. The glass carries no shadow of its own: menus clip and scroll, and a
 * clip cuts the slab's shadow, so the element's `shadows` lift it instead. It opens by scaling
 * rather than fading: an element below full opacity paints in an isolated layer, where glass
 * sees no backdrop and reads as a grey slab until the fade ends.
 */
export function menuGlass(t: Tokens) {
  return derive(t, "menu-glass", (t) => {
    const fx: FxLayer = {
      glass: {
        bevel: 8,
        depth: 14,
        dispersion: 0.06,
        magnification: 1.02,
        frost: 0.1,
        frostSigma: 40,
        saturation: t.dark ? 1.6 : 1.7,
        perceptual: true,
        rim: t.dark ? 0.2 : 0.04,
        shadow: 0,
        veil: t.dark ? 0.9 : 0.92,
        adapt: 0.25,
        tint: t.dark ? mix(t.c.overlaySurface, 85, t.c.background) : t.c.background,
      },
    };
    return {
      fx,
      enter: { scale: 0.96, dur: 0.18 } satisfies Effect,
      border: t.dark ? t.c.border : alpha(t.c.border, 0.6),
      shadows: t.dark ? [{ x: 0, y: 12, blur: 36, spread: -6, color: "rgba(0,0,0,0.5)" }] : [{ x: 0, y: 10, blur: 30, spread: -6, color: "rgba(0,0,0,0.14)" }],
      /** The hover and selection pill, as the top bar's shown tab. */
      pill: mixOklch(t.c.foreground, t.dark ? 12 : 8, "transparent"),
    };
  });
}
