import type { FxLayer } from "../../host/rune-jsx/props";
import { derive, type Tokens } from "../theme";

/** Liquid Glass for the chrome that floats over the chat: the top bar's capsules and the composer. */
export function chromeGlass(t: Tokens) {
  return derive(t, "chrome-glass", (t) => {
    const tint = t.c.background;
    const controls: FxLayer = {
      glass: { bevel: 12, depth: 24, dispersion: 0.08, magnification: 1.05, rim: t.dark ? 0.2 : 0.3, shadow: t.dark ? 0.35 : 0.18, frost: 0.22, frostSigma: 4, veil: t.dark ? 0.42 : 0.45, tint },
    };
    const composer: FxLayer = {
      glass: { bevel: 16, depth: 28, dispersion: 0.08, magnification: 1.04, rim: t.dark ? 0.2 : 0.3, shadow: t.dark ? 0.2 : 0.1, frost: 0.22, frostSigma: 4, veil: t.dark ? 0.45 : 0.5, tint },
    };
    return { controls, composer };
  });
}
