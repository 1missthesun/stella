/**
 * Email (the Email tab and page, Today and its bell notices, the `email` tool).
 * On in every build.
 *
 * Turning the feature on only shows it: no mail is read in the background until
 * the owner turns sorting on from the Email page (`email.setEnabled`), which is
 * what creates the Gmail watch and schedules every email job. The `email` tool
 * reads, drafts or sends mail only when the owner asks for it in a chat.
 *
 * Set this false to hide email again everywhere except where `EMAIL_FEATURE=1`
 * (backend var) or `STELLA_EMAIL_FEATURE=1` (desktop runtime) is set.
 */
export const EMAIL_FEATURE_ENABLED = true;

/** Whether a backend (from its env vars) runs email. */
export const emailFeatureOnFor = (env: unknown): boolean =>
  EMAIL_FEATURE_ENABLED ||
  String((env as Record<string, unknown> | null | undefined)?.EMAIL_FEATURE ?? "").trim() === "1";
