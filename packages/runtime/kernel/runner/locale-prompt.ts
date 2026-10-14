import {
  LOCALE_ENGLISH_NAMES,
  isSupportedLocale,
} from "@stella/contracts/locales";

export const getResponseLanguageSystemPrompt = (
  locale: string | undefined,
): string | undefined => {
  if (!locale) return undefined;
  const normalized = locale.trim();
  if (!normalized || normalized === "en" || normalized.startsWith("en-")) {
    return undefined;
  }
  if (!isSupportedLocale(normalized)) return undefined;
  const name = LOCALE_ENGLISH_NAMES[normalized];
  return [
    `Respond to the user in ${name} (${normalized}) unless the user explicitly switches.`,
    "Keep code, commands, filenames, API names, and quoted source text in their original language.",
  ].join(" ");
};

export const responseLanguageSection = (
  locale: string | undefined,
): { id: string; text: string } | undefined => {
  const directive = getResponseLanguageSystemPrompt(locale);
  return directive
    ? { id: "user-language", text: `## User Language\n${directive}` }
    : undefined;
};
