import type { Effect, FxLayer } from "../../host/rune-jsx/props";
import { alpha, derive, mix, type Shadow, type Tokens } from "../theme";

/** A surface's material: Liquid Glass (`fx`), or the opaque `fill` it falls back to under Reduce Transparency, with its edge and shadows. */
export type Material = { fx?: FxLayer; fill?: string; border?: string; shadows?: Shadow[] };

/** The opaque edge a solid surface takes for Reduce Transparency: the theme's strong border, and stronger still for Increase Contrast. */
export function solidEdge(t: Tokens) {
  return t.material.contrast ? mix(t.c.foreground, 45, t.c.background) : t.c.borderStrong;
}


/**
 * The phone app's `regular` + `legible` glass (`tintColor = fadeHex(surface, 0.78)`, packages/mobile
 * glass.tsx) for surfaces that hold text over any content: menus, popovers, dialogs and toasts. It
 * is the composer's material under a denser surface veil. The glass carries no shadow of its own (a
 * clip would cut it), so `shadows` lift the element. Under Reduce Transparency it is the veil's
 * colour, opaque, with a stronger edge.
 */
export function legibleGlass(t: Tokens, shadows: Material["shadows"], veil = t.dark ? 0.74 : 0.7): Material {
  // Fitted to an iOS 26.2 menu over the same backdrop (blur, saturation, veil and tint): Apple keeps
  // what is behind vivid and dims its luminance under a dark, near-background veil, rather than
  // greying it under a lighter one, which reads frosted.
  const tint = t.c.background;
  if (t.material.solid) return { fill: tint, border: solidEdge(t), shadows };
  return {
    fx: {
      glass: {
        bevel: 10,
        depth: 16,
        dispersion: 0.02,
        magnification: 1.02,
        frost: 0.15,
        frostSigma: 32,
        saturation: t.dark ? 1.7 : 1.55,
        perceptual: true,
        rim: t.dark ? 0.95 : 0.9,
        shadow: t.dark ? 0.34 : 0.085,
        veil,
        adapt: 0.2,
        tint,
      },
    },
  };
}

/**
 * How a legible glass surface appears: by scaling, never fading. An element below full opacity
 * paints in an isolated layer, where glass sees no backdrop and reads as a grey slab until the fade ends.
 */
export const GLASS_ENTER = { scale: 0.96, dur: 0.18 } satisfies Effect;

/** A modal dialog over its scrim: legible glass with a denser veil, since a whole page of text sits on it, lifted by the theme's largest shadow. */
export function dialogGlass(t: Tokens) {
  return derive(t, "dialog-glass", (t) => {
    const m = legibleGlass(t, t.shadow.xl, t.dark ? 0.86 : 0.88);
    return { ...m, enter: { scale: 0.96, dur: 0.24 } satisfies Effect, exit: { scale: 0.97, dur: 0.12 } satisfies Effect };
  });
}
