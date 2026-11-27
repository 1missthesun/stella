import { SettingsCard, SettingsRow, SettingsSelect } from "./parts";
import { T } from "../kit/compat";
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
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <SettingsCardTitle titleKey="settings.language.title" variant="row" />
          <T w="full" {...s.settingsRowSublabel}>{t("settings.language.description")}</T>
        </col>
        <row {...s.settingsRowControl}>
          <SettingsSelect value={locale} onValueChange={(next) => setLocale(next)} options={localeOptions} aria-label={t("settings.language.title")} />
        </row>
      </SettingsRow>
    </SettingsCard>
  );
}
