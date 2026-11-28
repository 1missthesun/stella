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
    const base = { dispersion: 0.02, frost: 0.14, frostSigma: 24, perceptual: true, adapt: 0.22 };
    const controlsTint = t.dark ? mix(t.c.overlaySurface, 54, t.c.background) : t.c.overlaySurface;
    const composerTint = t.dark ? mix(t.c.overlaySurface, 88, t.c.background) : t.c.overlaySurface;
    const hairline = t.dark ? t.c.border : alpha(t.c.border, 0.6);
    if (t.material.solid) {
      const edge = solidEdge(t);
      const controls: Material = { fill: composerTint, border: edge };
      return { controls, composer: { fill: composerTint, border: edge } as Material, clear: controls, hairline: edge, sheen: undefined };
    }
    const controls: Material = {
      fx: { glass: { ...base, bevel: 11, depth: 18, magnification: 1.03, saturation: t.dark ? 1.1 : 1.45, rim: t.dark ? 0.95 : 0.9, shadow: t.dark ? 0.16 : 0.048, veil: t.dark ? 0.46 : 0.58, tint: controlsTint, interactive: true } },
    };
    const composer: Material = {
      fx: { glass: { ...base, bevel: 11, depth: 18, magnification: 1.025, saturation: t.dark ? 1.12 : 1.5, rim: t.dark ? 0.92 : 0.85, shadow: t.dark ? 0.14 : 0.044, veil: t.dark ? 0.67 : 0.72, tint: composerTint, interactive: false } },
    };
    const clear: Material = {
      fx: {
        glass: {
          bevel: 13,
          depth: 18,
          dispersion: 0.02,
          magnification: 1.05,
          frost: 0.14,
          frostSigma: 22,
          saturation: 1.12,
          perceptual: true,
          rim: t.dark ? 1.05 : 0.98,
          shadow: t.dark ? 0.12 : 0.04,
          veil: 0.095,
          adapt: 0.1,
          tint: "#ffffff",
          interactive: true,
        },
      },
    };
    /** Subtle top-to-bottom internal sheen handled primarily by the shader's meniscus/rim. */
    const sheen: Gradient | undefined = t.dark ? { angle: 180, stops: [[0, "rgba(255,255,255,0)"], [1, "rgba(255,255,255,0.022)"]] } : undefined;
    return { controls, composer, clear, hairline, sheen };
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
  return { glass: { ...fx.glass, group: COMPOSER_GROUP, spacing: 20, ...(grows ? { morphFrom: COMPOSER_GLASS_ID } : {}) } };
}

/** The faint top-to-bottom lightening inside a dark glass control; nothing in light or solid. Put it first among the control's children. */
export function GlassSheen({ radius }: { radius: number }) {
  const sheen = chromeGlass(useTokens()).sheen;
  if (!sheen) return null;
  return <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radius={radius} gradient={sheen} inert />;
}

const BackdropReport = createContext<((b: Backdrop) => void) | undefined>(undefined);

/** Hysteresis on the backdrop's luminance: dark glass turns light over bright backdrops, light glass turns dark only over genuinely dark backdrops (preserving translucent light glass over vibrant blues/purples/corals). */
function flips(dark: boolean, flipped: boolean, lum: number) {
  return dark ? lum > (flipped ? 0.58 : 0.70) : lum < (flipped ? 0.30 : 0.22);
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
