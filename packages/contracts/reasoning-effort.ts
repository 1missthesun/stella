/**
 * The reasoning-effort ladder every picker shows and every engine receives.
 * Each provider adapter maps a level to its own parameter, falling back to
 * the nearest level that provider supports.
 */
export const REASONING_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number];

export const DEFAULT_REASONING_EFFORT: ReasoningEffortLevel = "medium";

export const isReasoningEffortLevel = (
  value: unknown,
): value is ReasoningEffortLevel =>
  typeof value === "string" &&
  (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);

/**
 * A recognized level, or undefined. Legacy `minimal` reads as `low`; legacy
 * `default` / `auto` are not levels and read as undefined here.
 */
export const parseReasoningEffortLevel = (
  value: unknown,
): ReasoningEffortLevel | undefined => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "minimal") return "low";
  return isReasoningEffortLevel(normalized) ? normalized : undefined;
};

/** Any stored value as a level; anything unrecognized (legacy `default`) is medium. */
export const normalizeReasoningEffortLevel = (
  value: unknown,
): ReasoningEffortLevel =>
  parseReasoningEffortLevel(value) ?? DEFAULT_REASONING_EFFORT;

/**
 * The nearest level in `supported` to `requested`; ties go to the higher
 * level. Undefined only when `supported` is empty.
 */
export const nearestReasoningEffortLevel = <T extends ReasoningEffortLevel>(
  requested: ReasoningEffortLevel,
  supported: readonly T[],
): T | undefined => {
  const requestedIndex = REASONING_EFFORT_LEVELS.indexOf(requested);
  let nearest: T | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of supported) {
    const index = REASONING_EFFORT_LEVELS.indexOf(candidate);
    const distance = Math.abs(index - requestedIndex);
    if (
      distance < nearestDistance ||
      (distance === nearestDistance &&
        nearest !== undefined &&
        index > REASONING_EFFORT_LEVELS.indexOf(nearest))
    ) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
};

/** Each level to itself: for adapters that pass every level through unchanged. */
export const REASONING_EFFORT_PASSTHROUGH: Readonly<
  Record<ReasoningEffortLevel, ReasoningEffortLevel>
> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
