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

/**
 * Smallest output ceiling that still leaves room for an answer after thinking
 * at each effort. Reasoning and the answer share one ceiling, and effort-only
 * APIs (OpenAI, Grok, DeepSeek, Gemini 3, Claude adaptive) take no thinking cap,
 * so a ceiling below these can be spent entirely on thinking.
 */
export const REASONING_EFFORT_MIN_OUTPUT_TOKENS: Readonly<
  Record<ReasoningEffortLevel, number>
> = {
  low: 0,
  medium: 8_192,
  high: 24_576,
  xhigh: 49_152,
  max: 65_536,
};

/** The requested effort, lowered until its thinking fits under `outputCeiling`. */
export const reasoningEffortForOutputCeiling = (
  requested: ReasoningEffortLevel,
  outputCeiling: number,
): ReasoningEffortLevel => {
  for (let index = REASONING_EFFORT_LEVELS.indexOf(requested); index > 0; index -= 1) {
    const level = REASONING_EFFORT_LEVELS[index]!;
    if (outputCeiling >= REASONING_EFFORT_MIN_OUTPUT_TOKENS[level]) return level;
  }
  return "low";
};
