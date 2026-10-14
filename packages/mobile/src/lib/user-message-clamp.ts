export const USER_MESSAGE_COLLAPSE_LINES = 4;

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
