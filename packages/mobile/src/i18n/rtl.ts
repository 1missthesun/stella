/**
 * RTL on React Native is genuinely different from the web.
 *
 * On the web the desktop app just sets `dir="rtl"` on `<html>` and the whole
 * layout mirrors live. React Native has no such switch: layout direction is
 * a NATIVE flag (`I18nManager.forceRTL`) read by the native view hierarchy
 * when it is created. Flipping it at runtime leaves the already-mounted
 * native views laid out the old way, so the app must be RELOADED for the new
 * direction to take effect. This is a documented React Native constraint,
 * not something we can paper over in JS.
 *
 * So the contract here is:
 *
 *   - At startup, `syncLayoutDirection` aligns the native flag with the
 *     resolved locale. If they disagree (first launch in Arabic, or an OTA
 *     that changed the persisted locale), it flips the flag and reloads
 *     once — before any UI has been shown, so the user sees a splash, not a
 *     visible relaunch.
 *   - When the user CHANGES the language to/from an RTL locale in-app, the
 *     text swaps immediately but the layout direction cannot. We flip the
 *     flag and reload the app. Callers get told whether a reload is coming
 *     (`willReload`) so they can show a confirmation first rather than
 *     yanking the app out from under a half-typed message.
 *   - Switching between two LTR locales (or two RTL locales) never reloads.
 */

import { I18nManager } from "react-native";
import { isRtlLocale, type Locale } from "./locales";

export const needsDirectionFlip = (locale: Locale): boolean =>
  isRtlLocale(locale) !== I18nManager.isRTL;

const reload = async (): Promise<void> => {
  try {
    const Updates = await import("expo-updates");
    await Updates.reloadAsync();
    return;
  } catch {
    /* fall through to the dev-only reloader */
  }
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
