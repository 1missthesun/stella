/**
 * Email sorting and briefings (the Email tab and page, the email row in the
 * chat, briefings in the bell, the `email` tool). Off in released builds
 * until the redesign is approved.
 *
 * With this false, only the dev backend's `EMAIL_FEATURE=1` var turns it on:
 * clients ask the backend through the `email.available` view, and the desktop
 * runtime through `STELLA_EMAIL_FEATURE=1`. Production never sets either, so
 * every entry point stays hidden there and the backend does no email work.
 */
export const EMAIL_FEATURE_ENABLED = false;

/** Whether a backend (from its env vars) runs email. */
export const emailFeatureOnFor = (env: unknown): boolean =>
  EMAIL_FEATURE_ENABLED ||
  String((env as Record<string, unknown> | null | undefined)?.EMAIL_FEATURE ?? "").trim() === "1";
