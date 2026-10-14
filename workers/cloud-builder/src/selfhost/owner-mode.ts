export type OwnerModeSignIn = "email" | "social";

const read = (env: unknown, name: string): string => {
  const value = (env as Record<string, unknown> | null | undefined)?.[name];
  return typeof value === "string" ? value.trim() : "";
};

export const ownerModeEnabled = (env: unknown): boolean => read(env, "STELLA_OWNER_MODE") === "1";

export const signInAllowed = (env: unknown, method: OwnerModeSignIn): boolean => {
  if (!ownerModeEnabled(env)) return true;
  return read(env, "STELLA_OWNER_MODE_SIGN_IN")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .includes(method);
};

export const signInMethodForAuthPath = (path: string | undefined): OwnerModeSignIn | null => {
  if (!path) return null;
  if (path === "/sign-in/magic-link" || path === "/magic-link/verify" || path.startsWith("/link/")) return "email";
  if (
    path === "/sign-in/social" ||
    path.startsWith("/callback") ||
    path.startsWith("/oauth2/") ||
    path === "/link-social" ||
    path === "/desktop-social/start" ||
    path === "/browser-social/start" ||
    path.startsWith("/sign-in/oauth2")
  ) {
    return "social";
  }
  return null;
};

export const ownerModeRefusesAuthPath = (env: unknown, path: string | undefined): boolean => {
  if (!ownerModeEnabled(env)) return false;
  if (path === "/sign-up/email" || path === "/sign-in/email") return true;
  const method = signInMethodForAuthPath(path);
  return method !== null && !signInAllowed(env, method);
};

const positiveNumber = (raw: string, fallback: number): number => {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const DEFAULT_OWNER_MODE_MONTHLY_AGENT_HOURS = 40;
export const DEFAULT_OWNER_MODE_MAX_CONCURRENT_AGENTS = 3;

export const cloudAgentCaps = (env: unknown): { monthlyHours: number; maxConcurrent: number } => {
  const owner = ownerModeEnabled(env);
  return {
    monthlyHours: positiveNumber(
      read(env, "STELLA_CLOUD_AGENT_MONTHLY_HOURS"),
      owner ? DEFAULT_OWNER_MODE_MONTHLY_AGENT_HOURS : 0,
    ),
    maxConcurrent: Math.floor(
      positiveNumber(
        read(env, "STELLA_CLOUD_AGENT_MAX_CONCURRENT"),
        owner ? DEFAULT_OWNER_MODE_MAX_CONCURRENT_AGENTS : 0,
      ),
    ),
  };
};
