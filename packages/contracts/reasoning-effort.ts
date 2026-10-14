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

export const parseReasoningEffortLevel = (
  value: unknown,
): ReasoningEffortLevel | undefined => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "minimal") return "low";
  return isReasoningEffortLevel(normalized) ? normalized : undefined;
};

export const normalizeReasoningEffortLevel = (
  value: unknown,
): ReasoningEffortLevel =>
  parseReasoningEffortLevel(value) ?? DEFAULT_REASONING_EFFORT;

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

export const REASONING_EFFORT_PASSTHROUGH: Readonly<
  Record<ReasoningEffortLevel, ReasoningEffortLevel>
> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
