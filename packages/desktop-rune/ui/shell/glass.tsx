import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Backdrop } from "../../host/rune-jsx/props";
import { solidEdge, type Material } from "../kit/legible-glass";
import { alpha, derive, mix, ModeScope, useTokens, type Tokens } from "../theme";

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
      return { controls, composer: { fill: composerTint, border: edge } as Material, hairline: edge };
    }
    const controls: Material = {
      fx: { glass: { ...base, bevel: 7, depth: 14, magnification: 1.04, saturation: 1.3, rim: t.dark ? 0.3 : 0.08, shadow: t.dark ? 0.15 : 0.05, veil: 0.75, tint: controlsTint } },
    };
    const composer: Material = {
      fx: { glass: { ...base, bevel: 8, depth: 16, magnification: 1.03, saturation: t.dark ? 1.6 : 1.7, rim: t.dark ? 0.2 : 0.04, shadow: 0, veil: t.dark ? 0.8 : 0.82, tint: composerTint } },
      border: hairline,
    };
    return { controls, composer, hairline };
  });
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
