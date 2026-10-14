import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useCallback } from "react";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { clearOnboardingChatProgress } from "./onboarding-chat-flow";
import { clearPendingHandoff } from "./pending-handoff";
import { resetDiscoveryJob } from "./discovery-job";

export function OnboardingReplayCard() {
  const t = useT();
  const { reset } = useOnboardingState();

  const handleReplay = useCallback(() => {
    clearOnboardingChatProgress();
    clearPendingHandoff();
    resetDiscoveryJob();
    reset();
  }, [reset]);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <SettingsCardTitle titleKey="settings.onboardingReplay.title" />
        <Button
          type="button"
          variant="ghost"
          className="pill-btn"
          onClick={handleReplay}
        >
          {t("settings.onboardingReplay.action")}
        </Button>
      </div>
      <p className="settings-card-desc">
        {t("settings.onboardingReplay.description")}
      </p>
    </div>
  );
}
