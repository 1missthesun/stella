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
  telemetryEnabled: boolean;
  supportAccessUntil: number | null;
  supportAccessLog: SupportAccessEntry[];
};

export type SupportAccessEntry = {
  at: number;
  action: "granted" | "revoked" | "accessed";
  tool?: string;
};

export type PreferenceCalls = {
  "preferences.set": {
    args: {
      locale?: PreferenceLocale;
      preferredBrowser?: PreferredBrowser;
      telemetryEnabled?: boolean;
    };
    result: Preferences;
  };
  "support.grant": { args: Record<string, never>; result: Preferences };
  "support.revoke": { args: Record<string, never>; result: Preferences };
  "feedback.submit": {
    args: { message: string; appVersion?: string; platform?: string };
    result: null;
  };
};

export type PreferenceViews = {
  "preferences.get": { args: Record<string, never>; result: Preferences };
};
