import { SettingsCard, SettingsRow, SettingsTabContent } from "../parts";
import { Select, T } from "../../kit/compat";
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
      <LanguageSettingsRow />
      <SettingsCard>
        <SettingsCardTitle titleKey="settings.motion.title" />
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("settings.motion.reduceMotion.label")}
            </T>
            <T w="full" {...s.settingsRowSublabel}>
              {t("settings.motion.reduceMotion.description")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Select {...s.settingsRuntimeSelect} value={reduceMotion} aria-label={t("settings.motion.reduceMotion.label")} onValueChange={(value) =>
                setReduceMotionPreference(value as ReduceMotionPreference)
              } options={[
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
              ]} />
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
