/**
 * On iOS `react-native-svg` draws each `<Svg>` into its layer at its laid-out
 * bounds, so a parent transform scales that bitmap. Dots are laid out at their
 * resting pixel size and the morph scales them up from there.
 */

import { STELLA_MARK_CENTER, STELLA_MARK_VIEWBOX_SPAN } from "./geometry";
import { DOT_RADIUS_UNITS, DOT_SPREAD_UNITS, SIDE_DOT_SCALE } from "./motion";
import { rigMaxZoom } from "./rig";

export const DOT_SHRINK = DOT_RADIUS_UNITS / STELLA_MARK_CENTER;

export function markZoom(size: number): number {
  return rigMaxZoom(size);
}

export type StellaMarkLayout = {
  pxPerUnit: number;
  zoom: number;
  spreadPx: number;
  dotPx: number;
  sideDotPx: number;
  dotOversize: number;
};

export function stellaMarkLayout(size: number): StellaMarkLayout {
  const zoom = markZoom(size);
  const pxPerUnit = size / STELLA_MARK_VIEWBOX_SPAN;
  const dotPx = size * DOT_SHRINK * zoom;
  return {
    pxPerUnit,
    zoom,
    spreadPx: DOT_SPREAD_UNITS * pxPerUnit * zoom,
    dotPx,
    sideDotPx: dotPx * SIDE_DOT_SCALE,
    dotOversize: size / dotPx,
  };
}
