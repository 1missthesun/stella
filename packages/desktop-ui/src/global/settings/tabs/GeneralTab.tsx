import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { lazy, Suspense } from "react";
import {
  AiryWordPicker,
  SettingsTabHeader,
} from "@/global/settings/AiryControls";
import { LanguageSettingsRow } from "@/global/settings/LanguageSettingsRow";
import {
  setReduceMotionPreference,
  useInterfacePreferences,
  type ReduceMotionPreference,
} from "@/shared/lib/interface-preferences";
import { useT } from "@/shared/i18n";
import { platformCapabilities } from "@/platform/capabilities";
import { CompanionSettingsCard } from "./CompanionSettingsCard";

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
  const t = useT();
  const { reduceMotion } = useInterfacePreferences();

  return (
    <div className="settings-tab-content">
      <SettingsTabHeader titleKey="settings.tabs.general" />
      <LanguageSettingsRow />
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <SettingsCardTitle
              titleKey="settings.motion.title"
              labelKey="settings.motion.reduceMotion.label"
              variant="row"
            />
          </div>
          <div className="settings-row-control">
            <AiryWordPicker
              value={reduceMotion}
              ariaLabel={t("settings.motion.reduceMotion.label")}
              onChange={(next) =>
                setReduceMotionPreference(next as ReduceMotionPreference)
              }
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
          </div>
        </div>
      </div>
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
    </div>
  );
}
