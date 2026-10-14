export const USER_MESSAGE_OVERFLOW_EPSILON_PX = 1;

export function isUserMessageOverflowing(args: {
  scrollHeight: number;
  clientHeight: number;
  epsilonPx?: number;
}): boolean {
  return (
    args.scrollHeight - args.clientHeight >
    (args.epsilonPx ?? USER_MESSAGE_OVERFLOW_EPSILON_PX)
  );
}

export function shouldShowUserMessageToggle(args: {
  overflowing: boolean;
  expanded: boolean;
}): boolean {
  return args.overflowing || args.expanded;
}
