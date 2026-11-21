export const normalizeOwnerGeneration = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
};

export const ownerGenerationMatches = (
  expected: string | undefined,
  incoming: unknown,
): boolean => {
  const normalized = normalizeOwnerGeneration(incoming);
  return Boolean(expected && normalized === expected);
};
