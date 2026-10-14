export const USER_MESSAGE_COLLAPSE_LINES = 4;

/**
 * Line cap used while measuring overflow. One line beyond the collapse cap is
 * enough to distinguish "fits in four lines" from "overflows", so a long sent
 * message never paints at full height first — which used to briefly inflate
 * the row and skew the post-send scroll anchor before the clamp collapsed it.
 */
export const USER_MESSAGE_MEASURE_LINES = USER_MESSAGE_COLLAPSE_LINES + 1;


export const USER_MESSAGE_WIDTH_REMEASURE_EPSILON_PX = 1;

export function isUserMessageTruncatable(
  totalLines: number | null,
  maxLines: number = USER_MESSAGE_COLLAPSE_LINES,
): boolean {
  return totalLines !== null && totalLines > maxLines;
}

export function userMessageNumberOfLines(args: {
  expanded: boolean;
  measuring: boolean;
  truncatable: boolean;
}): number | undefined {
  if (args.expanded) return undefined;
  if (args.measuring) return USER_MESSAGE_MEASURE_LINES;
  return args.truncatable ? USER_MESSAGE_COLLAPSE_LINES : undefined;
}

export function shouldRemeasureUserMessageWidth(
  previousWidth: number | null,
  nextWidth: number,
  epsilonPx: number = USER_MESSAGE_WIDTH_REMEASURE_EPSILON_PX,
): boolean {
  return (
    previousWidth !== null && Math.abs(previousWidth - nextWidth) >= epsilonPx
  );
}
