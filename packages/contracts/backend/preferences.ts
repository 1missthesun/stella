/**
 * Account preferences (locale, preferred browser) and feedback.
 */

/** App languages; mirrors the desktop's `SUPPORTED_LOCALES`. */
export const PREFERENCE_LOCALES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "nl",
  "ru",
  "ja",
  "zh-Hans",
  "zh-Hant",
  "ko",
  "pl",
  "sv",
  "nb",
  "da",
  "fi",
  "cs",
  "el",
  "tr",
  "ro",
  "hu",
  "ar",
  "hi",
  "id",
  "vi",
  "th",
  "he",
] as const;
export type PreferenceLocale = (typeof PREFERENCE_LOCALES)[number];

export const PREFERRED_BROWSERS = [
  "arc",
  "brave",
  "chrome",
  "edge",
  "firefox",
  "opera",
  "safari",
  "vivaldi",
  "none",
] as const;
export type PreferredBrowser = (typeof PREFERRED_BROWSERS)[number];

export const FEEDBACK_MAX_CHARS = 32_000;

export type Preferences = {
  locale: PreferenceLocale | null;
  preferredBrowser: PreferredBrowser | null;
  /**
   * Metadata-only product telemetry for this account. On unless the owner
   * turned it off; billing records are not telemetry and are unaffected.
   */
  telemetryEnabled: boolean;
  /** Epoch ms until which the owner has granted support access, or null. */
  supportAccessUntil: number | null;
  /** Grants, revocations and uses of support access, oldest first. */
  supportAccessLog: SupportAccessEntry[];
};

export type SupportAccessEntry = {
  at: number;
  action: "granted" | "revoked" | "accessed";
  /** What used the grant, for `accessed` entries. */
  tool?: string;
};

export type PreferenceCalls = {
  /** Set any of the preferences; returns all of them. */
  "preferences.set": {
    args: {
      locale?: PreferenceLocale;
      preferredBrowser?: PreferredBrowser;
      telemetryEnabled?: boolean;
    };
    result: Preferences;
  };
  /** Grant support access for 24 hours. Recorded in the access log. */
  "support.grant": { args: Record<string, never>; result: Preferences };
  /** End a support grant now. Recorded in the access log. */
  "support.revoke": { args: Record<string, never>; result: Preferences };
  /** Anonymous by design: nothing about the sender is stored. */
  "feedback.submit": {
    args: { message: string; appVersion?: string; platform?: string };
    result: null;
  };
};

export type PreferenceViews = {
  "preferences.get": { args: Record<string, never>; result: Preferences };
};
