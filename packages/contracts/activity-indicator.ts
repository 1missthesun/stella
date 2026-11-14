export type ActivityIndicatorEntry = {
  id: string;
  title: string;
};

export const ACTIVITY_INDICATOR_MENU_MAX_ROWS = 9;

export type ActivityIndicatorPhase = "idle" | "spawn" | "working";

export const ACTIVITY_INDICATOR_SPAWN_BEAT_MS = 1100;

export const ACTIVITY_INDICATOR_LABEL_IN_MS = 260;
export const ACTIVITY_INDICATOR_LABEL_IN_DELAY_MS = 120;
export const ACTIVITY_INDICATOR_LABEL_OUT_MS = 140;

export const ACTIVITY_INDICATOR_MARK_IN_MS = 220;
export const ACTIVITY_INDICATOR_MARK_OUT_MS = 160;

export const ACTIVITY_INDICATOR_SETTLE_SPRING = {
  durationMs: 420,
  dampingRatio: 0.88,
} as const;

export const ACTIVITY_INDICATOR_POP_SCALE = 1.14;
export const ACTIVITY_INDICATOR_POP_RISE_MS = 160;
export const ACTIVITY_INDICATOR_POP_SETTLE_SPRING = {
  damping: 12,
  stiffness: 180,
} as const;

export type ActivityIndicatorTransition = "spawn" | "settle" | "none";

export const activityIndicatorTransition = (
  count: number,
  previousCount: number,
): ActivityIndicatorTransition => {
  if (count > previousCount) return "spawn";
  if (count === 0 && previousCount > 0) return "settle";
  return "none";
};

export const selectActivityIndicatorLabel = (
  running: readonly ActivityIndicatorEntry[],
  formatCount: (count: number) => string,
): string | null => {
  if (running.length === 0) return null;
  if (running.length === 1) return running[0]!.title;
  return formatCount(running.length);
};

export const activityIndicatorMenuEntries = (
  running: readonly ActivityIndicatorEntry[],
): ActivityIndicatorEntry[] =>
  running.slice(0, ACTIVITY_INDICATOR_MENU_MAX_ROWS);
