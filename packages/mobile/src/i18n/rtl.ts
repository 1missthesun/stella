/**
 * React Native layout direction is a native flag (`I18nManager.forceRTL`)
 * read by the native view hierarchy when it is created. Flipping it at
 * runtime leaves the already-mounted native views laid out the old way, so
 * the app must be reloaded for the new direction to take effect.
 */

import { I18nManager } from "react-native";
import { isRtlLocale, type Locale } from "@stella/contracts/locales";

export const needsDirectionFlip = (locale: Locale): boolean =>
  isRtlLocale(locale) !== I18nManager.isRTL;

const reload = async (): Promise<void> => {
  try {
    const Updates = await import("expo-updates");
    await Updates.reloadAsync();
    return;
  } catch {}
  try {
    const { DevSettings } = await import("react-native");
    DevSettings.reload();
  } catch {
    // Nothing left to try. The flag is persisted natively, so the new
    // direction applies the next time the user launches the app.
  }
};

export const applyLayoutDirection = async (
  locale: Locale,
): Promise<boolean> => {
  const shouldBeRTL = isRtlLocale(locale);
  if (shouldBeRTL === I18nManager.isRTL) return false;
  I18nManager.allowRTL(shouldBeRTL);
  I18nManager.forceRTL(shouldBeRTL);
  await reload();
  return true;
};

export const syncLayoutDirection = (locale: Locale): void => {
  if (isRtlLocale(locale) === I18nManager.isRTL) return;
  void applyLayoutDirection(locale);
};
