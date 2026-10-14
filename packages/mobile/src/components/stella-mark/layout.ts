/**
 * Pixel layout of the thinking ellipsis, split out of the component for the
 * same reason as `motion.ts`: it is arithmetic, so it is worklet-safe and
 * directly testable.
 *
 * `react-native-svg` rasterizes an `<Svg>` at the size it is laid out at, and a
 * parent transform then resamples that bitmap rather than re-rendering the
 * vector. A dot drawn at the full mark size and scaled down ~5x therefore lands
 * as a jagged blob that shimmers as the wave animates it. So each dot is laid
 * out at the pixel size it settles on and the morph scales it *up* at the
 * start, which puts the resting state at exactly scale 1.
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
