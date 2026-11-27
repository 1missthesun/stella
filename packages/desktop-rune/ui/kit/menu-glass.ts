import type { FxLayer, Glass } from "../../host/rune-jsx/props";
import { derive, mixOklch, type Tokens } from "../theme";
import { GLASS_ENTER, legibleGlass } from "./legible-glass";

/** Corner radius of a glass menu; its items are pills inset by the menu's padding. */
export const MENU_GLASS_RADIUS = 22;
/** Corner radius of a glass popover (free-form content rather than pill rows). */
export const POPOVER_GLASS_RADIUS = 18;

/**
 * Liquid Glass for menus and popovers (`legibleGlass`): one glass element per menu. An anchored one
 * grows out of its trigger (`morph`: `morphFrom` the anchor) and goes back into it; anything else,
 * and a solid menu under Reduce Transparency, opens by scaling (`enter`).
 */
export function menuGlass(t: Tokens) {
  return derive(t, "menu-glass", (t) => {
    const m = legibleGlass(t, t.dark ? [{ x: 0, y: 12, blur: 36, spread: -6, color: "rgba(0,0,0,0.5)" }] : [{ x: 0, y: 10, blur: 30, spread: -6, color: "rgba(0,0,0,0.14)" }]);
    return {
      ...m,
      /** `fx` growing out of the element's anchor: a menu's or popover's own entrance, with no `enter`. */
      morph: m.fx ? ({ glass: { ...((m.fx as { glass: Glass }).glass), morphFrom: true } } satisfies FxLayer) : undefined,
      enter: GLASS_ENTER,
      /** The hover and selection pill, as the top bar's shown tab. */
      pill: mixOklch(t.c.foreground, t.dark ? 12 : 8, "transparent"),
    };
  });
}
