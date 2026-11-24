export const EMAIL_FEATURE_ENABLED = true;

export const emailFeatureOnFor = (env: unknown): boolean =>
  EMAIL_FEATURE_ENABLED ||
  String((env as Record<string, unknown> | null | undefined)?.EMAIL_FEATURE ?? "").trim() === "1";
