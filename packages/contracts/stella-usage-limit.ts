/**
 * Stella's own usage limit: the owner's plan has no room left for Stella's
 * models. The Free plan's one-time allowance is spent (it never comes back),
 * or a plan window is used up (it resets). Trying again never helps;
 * upgrading does. Every place that refuses for this reason (the cloud turn
 * start, the model gateway, a turn that runs out midway) uses this code and
 * wording, so every client shows the same notice with an Upgrade action
 * instead of a generic failure.
 */

export const STELLA_USAGE_LIMIT_CODE = "usage_limit" as const;

export type StellaUsageLimitReason = "free_allowance" | "plan_limit";

export type StellaUsageLimit = {
  reason: StellaUsageLimitReason;
  /** The sentence to show, as the owner's billing words it. */
  message: string;
  /** When a plan window resets; absent for the Free allowance, which never does. */
  retryAfterMs?: number;
};

export const STELLA_USAGE_LIMIT_TITLES: Record<StellaUsageLimitReason, string> = {
  free_allowance: "You've used your free allowance",
  plan_limit: "You've reached your plan's limit",
};

/** The notice's body under its title, the same on every client. */
export const STELLA_USAGE_LIMIT_DESCRIPTIONS: Record<StellaUsageLimitReason, string> = {
  free_allowance: "Your free Stella allowance is spent. Upgrade to keep going.",
  plan_limit: "You've used what your plan includes for now. Upgrade to keep going, or wait until it resets.",
};

export const STELLA_USAGE_LIMIT_MESSAGES: Record<StellaUsageLimitReason, string> = {
  free_allowance: "You've used your free Stella allowance. Upgrade to keep going.",
  plan_limit: "You've reached your plan's usage limit. Upgrade to keep going, or wait until it resets.",
};

export const isStellaUsageLimitReason = (value: unknown): value is StellaUsageLimitReason =>
  value === "free_allowance" || value === "plan_limit";

/**
 * Stella can't read the owner's plan (billing is not configured on this
 * server). Turns on Stella's models are refused with this instead of a silent
 * zero budget; the server logs `billing_unconfigured`.
 */
export const BILLING_UNAVAILABLE_CODE = "billing_unavailable" as const;
export const BILLING_UNAVAILABLE_MESSAGE =
  "Stella can't check your plan right now. We've been alerted and are fixing it; try again a little later.";

const FREE_ALLOWANCE_PATTERNS = [
  "free stella allowance",
  "free allowance",
  "free_allowance",
  "lifetime allowance",
] as const;

const PLAN_LIMIT_PATTERNS = [
  "plan's usage limit",
  "plan usage limit reached",
  "plan limit reached",
  "paused for your plan",
  "\"code\":\"usage_limit\"",
  "usage_limit",
] as const;

/**
 * The usage limit an error text names, for hosts that only see a string (a
 * model error from the SDK, a failed send, a turn's terminal notice).
 */
export const stellaUsageLimitOf = (text: string | null | undefined): StellaUsageLimitReason | null => {
  const normalized = (text ?? "").toLowerCase();
  if (!normalized) return null;
  if (FREE_ALLOWANCE_PATTERNS.some((pattern) => normalized.includes(pattern))) return "free_allowance";
  if (PLAN_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern))) return "plan_limit";
  return null;
};

/**
 * The plain sentence for an error text that names the usage limit: the
 * message the gateway or backend sent (it may arrive inside a raw JSON
 * error body), else the reason's standard wording. Null when the text is
 * about something else.
 */
export const stellaUsageLimitText = (text: string | null | undefined): string | null => {
  const reason = stellaUsageLimitOf(text);
  if (!reason) return null;
  const quoted = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text ?? "")?.[1];
  if (quoted) {
    const unquoted = quoted.replace(/\\(.)/g, "$1").trim();
    if (stellaUsageLimitOf(unquoted)) return unquoted;
  }
  const plain = (text ?? "").trim();
  return plain && !/[{}]/.test(plain) && plain.length <= 240 ? plain : STELLA_USAGE_LIMIT_MESSAGES[reason];
};
