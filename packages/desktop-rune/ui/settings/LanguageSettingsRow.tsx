import { SettingsCard, SettingsRow } from "./parts";
import { Select, T } from "../kit/compat";
import { useSettings } from "./settings.styles";
import { SettingsCardTitle } from "./settings-card-targets";
import { useMemo } from "react";
import { useT, useI18n, LOCALE_NATIVE_LABELS, type Locale } from "@/shared/i18n";

export function LanguageSettingsRow() {
  const s = useSettings();
  const t = useT();
  const { locale, setLocale, supportedLocales } = useI18n();
  const localeOptions = useMemo(
    () =>
      supportedLocales.map((code) => ({
        value: code,
        label: LOCALE_NATIVE_LABELS[code],
      })),
    [supportedLocales],
  );

  return (
    <SettingsCard>
      <SettingsCardTitle titleKey="settings.language.title" />
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>{t("common.language")}</T>
        </col>
        <row {...s.settingsRowControl}>
          <Select {...s.settingsRuntimeSelect} value={locale} onValueChange={(next) => setLocale(next)} options={localeOptions} aria-label={t("common.language")} />
        </row>
      </SettingsRow>
    </SettingsCard>
  );
}
