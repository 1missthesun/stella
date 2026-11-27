import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Backdrop, FxLayer, Glass } from "../../host/rune-jsx/props";
import { solidEdge, type Material } from "../kit/legible-glass";
import { alpha, derive, mix, ModeScope, useTokens, type Gradient, type Tokens } from "../theme";

/**
 * Liquid Glass for the chrome that floats over the chat (the top bar's capsules, the scroll button
 * and the composer), fitted to the phone app's UIGlassEffect (`look-ios-refs/README.md` on
 * `rune/look-ios-refs`): a heavy veil of the surface colour, a saturated hint of what is behind, a
 * small blur, lensing within a few points of the edge, a faint rim, and no drop shadow on the
 * composer, whose edge is the app's hairline instead. Under Reduce Transparency each is an opaque
 * surface of the glass's own tint with a stronger edge, as Apple's controls become.
 */
export function chromeGlass(t: Tokens) {
  return derive(t, "chrome-glass", (t) => {
    const base = { dispersion: 0.08, frost: 0.1, frostSigma: 26, perceptual: true, adapt: 0.25 };
    const controlsTint = t.dark ? mix(t.c.overlaySurface, 12, t.c.background) : t.c.overlaySurface;
    const composerTint = t.dark ? mix(t.c.overlaySurface, 70, t.c.background) : t.c.overlaySurface;
    const hairline = t.dark ? t.c.border : alpha(t.c.border, 0.6);
    if (t.material.solid) {
      const edge = solidEdge(t);
      const controls: Material = { fill: composerTint, border: edge };
      return { controls, composer: { fill: composerTint, border: edge } as Material, hairline: edge, sheen: undefined };
    }
    const controls: Material = {
      fx: { glass: { ...base, bevel: 7, depth: 14, magnification: 1.04, saturation: 1.3, rim: t.dark ? 0.3 : 0.08, shadow: t.dark ? 0.15 : 0.05, veil: 0.75, tint: controlsTint } },
    };
    const composer: Material = {
      fx: { glass: { ...base, bevel: 8, depth: 16, magnification: 1.03, saturation: t.dark ? 1.6 : 1.7, rim: t.dark ? 0.2 : 0.04, shadow: 0, veil: t.dark ? 0.8 : 0.82, tint: composerTint } },
      border: hairline,
    };
    /** The phone's dark glass buttons lighten toward the bottom (22 at the top, 33 at the bottom over black); light ones are flat. */
    const sheen: Gradient | undefined = t.dark ? { angle: 180, stops: [[0, "rgba(255,255,255,0)"], [1, "rgba(255,255,255,0.045)"]] } : undefined;
    return { controls, composer, hairline, sheen };
  });
}

/** The main chat composer's glass element: the scroll-to-bottom button grows out of it. */
export const COMPOSER_GLASS_ID = "chat-composer-glass";
const COMPOSER_GROUP = "chat-composer";

/**
 * The composer's glass, and with `grows` the scroll-to-bottom button's, as one glass group (Apple's
 * GlassEffectContainer): the button rises out of the composer, pinching off it, and sinks back in.
 * Nothing under Reduce Transparency, where both are solid.
 */
export function composerGroupGlass(t: Tokens, grows = false): FxLayer | undefined {
  const fx = chromeGlass(t).composer.fx as { glass: Glass } | undefined;
  if (!fx) return undefined;
  return { glass: { ...fx.glass, group: COMPOSER_GROUP, ...(grows ? { morphFrom: COMPOSER_GLASS_ID } : {}) } };
}

/** The faint top-to-bottom lightening inside a dark glass control; nothing in light or solid. Put it first among the control's children. */
export function GlassSheen({ radius }: { radius: number }) {
  const sheen = chromeGlass(useTokens()).sheen;
  if (!sheen) return null;
  return <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radius={radius} gradient={sheen} inert />;
}

const BackdropReport = createContext<((b: Backdrop) => void) | undefined>(undefined);

/** Hysteresis on the backdrop's luminance: dark glass turns light over bright content, light glass turns dark over dark content. */
function flips(dark: boolean, flipped: boolean, lum: number) {
  return dark ? lum > (flipped ? 0.5 : 0.62) : lum < (flipped ? 0.5 : 0.38);
}

/**
 * Its glass and glyphs take the theme's other mode while what is behind the glass calls for it,
 * as Apple's small glass controls flip between light and dark. The glass element inside passes
 * `onBackdrop={useGlassBackdrop()}`.
 */
export function AdaptiveGlass({ children }: { children: ReactNode }) {
  const t = useTokens();
  const [flip, setFlip] = useState({ dark: t.dark, on: false });
  const on = !t.material.solid && flip.dark === t.dark && flip.on;
  const report = useCallback(
    (b: Backdrop) =>
      setFlip((f) => {
        const was = f.dark === t.dark && f.on;
        const next = flips(t.dark, was, b.lum);
        return f.dark === t.dark && was === next ? f : { dark: t.dark, on: next };
      }),
    [t.dark],
  );
  return (
    <BackdropReport.Provider value={report}>
      <ModeScope mode={t.dark !== on ? "dark" : "light"}>{children}</ModeScope>
    </BackdropReport.Provider>
  );
}

export const useGlassBackdrop = () => useContext(BackdropReport);
