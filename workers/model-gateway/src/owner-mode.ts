export const ownerModeEnabled = (env: unknown): boolean => {
  const value = (env as Record<string, unknown> | null | undefined)?.STELLA_OWNER_MODE;
  return typeof value === "string" && value.trim() === "1";
};
