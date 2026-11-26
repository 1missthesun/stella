import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useMemo } from "react";
import { useT, useI18n, LOCALE_NATIVE_LABELS, type Locale } from "@/shared/i18n";
import { Select } from "@/ui/select";

export function LanguageSettingsRow() {
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
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-info">
          <SettingsCardTitle titleKey="settings.language.title" variant="row" />
          <div className="settings-row-sublabel">
            {t("settings.language.description")}
          </div>
        </div>
        <div className="settings-row-control">
          <Select<Locale>
            className="settings-runtime-select"
            value={locale}
            onValueChange={(next) => setLocale(next)}
            options={localeOptions}
            aria-label={t("settings.language.title")}
          />
        </div>
      </div>
    </div>
  );
}
