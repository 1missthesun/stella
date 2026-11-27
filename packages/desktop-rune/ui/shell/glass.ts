import type { FxLayer } from "../../host/rune-jsx/props";
import { derive, type Tokens } from "../theme";

/** Liquid Glass for the chrome that floats over the chat: the top bar's capsules and the composer. */
export function chromeGlass(t: Tokens) {
  return derive(t, "chrome-glass", (t) => {
    const tint = t.c.background;
    const controls: FxLayer = {
      glass: { bevel: 10, depth: 12, dispersion: 0.05, magnification: 1.03, rim: t.dark ? 0.6 : 0.9, shadow: t.dark ? 0.3 : 0.16, frost: 0.55, frostSigma: 8, veil: t.dark ? 0.34 : 0.42, tint },
    };
    const composer: FxLayer = {
      glass: { bevel: 14, depth: 16, dispersion: 0.05, magnification: 1.03, rim: t.dark ? 0.6 : 0.9, shadow: 0, frost: 0.6, frostSigma: 9, veil: t.dark ? 0.4 : 0.5, tint },
    };
    return { controls, composer };
  });
}
