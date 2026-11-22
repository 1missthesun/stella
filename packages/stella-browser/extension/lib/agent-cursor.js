/**
 * The agent's cursor, drawn by Chrome's DevTools overlay rather than as an
 * element in the page: the overlay is painted by the browser above the page,
 * so page scripts cannot see it (no node, no mutation, no style), while the
 * person watching the tab still sees where the agent is pointing. It follows
 * the real pointer events the agent sends.
 */

const CURSOR_FILL = { r: 51, g: 156, b: 255, a: 1 };
const CURSOR_OUTLINE = { r: 255, g: 255, b: 255, a: 1 };

/** An arrow pointer with its tip at `point`, as an Overlay.highlightQuad quad. */
export const agentCursorQuad = ({ x, y }) => [
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
