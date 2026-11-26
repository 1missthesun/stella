import { SettingsCard, SettingsRow, SettingsTabContent } from "../parts";
import { AiryWordPicker, SettingsTabHeader } from "../AiryControls";
import { useSettings } from "../settings.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { lazy, Suspense } from "react";
import { LanguageSettingsRow } from "../LanguageSettingsRow";
import {
  setReduceMotionPreference,
  useInterfacePreferences,
  type ReduceMotionPreference,
} from "@/shared/lib/interface-preferences";
import { useT } from "@/shared/i18n";
import { platformCapabilities } from "@/platform/capabilities";
import { CompanionSettingsCard } from "@/global/settings/tabs/CompanionSettingsCard";

const NativeDesktopGeneralSettings = lazy(() =>
  import("./NativeGeneralSettings").then((module) => ({
    default: module.NativeDesktopGeneralSettings,
  })),
);

const NativeAskEscalationSettings = lazy(() =>
  import("./NativeAskEscalationSettings").then((module) => ({
    default: module.NativeAskEscalationSettings,
  })),
);

export function GeneralTab() {
  const s = useSettings();
  const t = useT();
  const { reduceMotion } = useInterfacePreferences();

  return (
    <SettingsTabContent>
      <SettingsTabHeader titleKey="settings.tabs.general" />
      <LanguageSettingsRow />
      <SettingsCard>
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <SettingsCardTitle titleKey="settings.motion.title" labelKey="settings.motion.reduceMotion.label" variant="row" />
          </col>
          <row {...s.settingsRowControl}>
            <AiryWordPicker
              value={reduceMotion}
              ariaLabel={t("settings.motion.reduceMotion.label")}
              onChange={(next) => setReduceMotionPreference(next as ReduceMotionPreference)}
              options={[
                {
                  value: "system",
                  label: t("settings.motion.reduceMotion.system"),
                },
                {
                  value: "on",
                  label: t("settings.motion.reduceMotion.on"),
                },
                {
                  value: "off",
                  label: t("settings.motion.reduceMotion.off"),
                },
              ]}
            />
          </row>
        </SettingsRow>
      </SettingsCard>
      {platformCapabilities.nativeSettings ? <CompanionSettingsCard /> : null}
      {platformCapabilities.nativeSettings ? (
        <Suspense fallback={null}>
          <NativeAskEscalationSettings />
        </Suspense>
      ) : null}
      {platformCapabilities.nativeSettings ? (
        <Suspense fallback={null}>
          <NativeDesktopGeneralSettings />
        </Suspense>
      ) : null}
    </SettingsTabContent>
  );
}
