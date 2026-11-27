import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Backdrop, FxLayer } from "../../host/rune-jsx/props";
import { derive, ModeScope, useTokens, type Tokens } from "../theme";

/** Liquid Glass for the chrome that floats over the chat: the top bar's capsules and the composer. */
export function chromeGlass(t: Tokens) {
  return derive(t, "chrome-glass", (t) => {
    const tint = t.c.overlaySurface;
    const controls: FxLayer = {
      glass: { bevel: 12, depth: 24, dispersion: 0.08, magnification: 1.05, rim: t.dark ? 0.2 : 0.3, shadow: t.dark ? 0.35 : 0.18, frost: 0.3, frostSigma: 6, veil: 0.7, tint, adapt: 0.6 },
    };
    const composer: FxLayer = {
      glass: { bevel: 16, depth: 28, dispersion: 0.08, magnification: 1.04, rim: t.dark ? 0.2 : 0.3, shadow: t.dark ? 0.2 : 0.1, frost: 0.3, frostSigma: 6, veil: 0.5, tint, adapt: 0.6 },
    };
    return { controls, composer };
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
  const on = flip.dark === t.dark && flip.on;
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
