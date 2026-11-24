const CURSOR_FILL = { r: 51, g: 156, b: 255, a: 1 };
const CURSOR_OUTLINE = { r: 255, g: 255, b: 255, a: 1 };

const agentCursorQuad = ({ x, y }) => [
  x,
  y,
  x,
  y + 20,
  x + 5.4,
  y + 15.2,
  x + 14.2,
  y + 14.2,
];

/**
 * Chrome scales highlight quads by the device pixel ratio once more than CSS
 * pixels need, so on a 2x display a quad given in CSS pixels lands at twice
 * its position and size. This is that ratio, read from Page.getLayoutMetrics.
 */
export const overlayScaleFromLayoutMetrics = (metrics) => {
  const device = metrics?.layoutViewport?.clientWidth;
  const css = metrics?.cssLayoutViewport?.clientWidth;
  return device > 0 && css > 0 ? device / css : 1;
};

/**
 * Overlay.highlightQuad parameters that draw the cursor at `point` (CSS
 * pixels); Overlay needs DOM and Overlay enabled first.
 */
export const agentCursorHighlightParams = (point, overlayScale = 1) => ({
  quad: agentCursorQuad(point).map((value) => value / overlayScale),
  color: CURSOR_FILL,
  outlineColor: CURSOR_OUTLINE,
});
