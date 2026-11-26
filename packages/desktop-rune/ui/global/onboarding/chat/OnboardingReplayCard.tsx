import { SettingsCard, SettingsCardDesc, SettingsCardHeader } from "../../../settings/parts";
import { Button } from "../../../kit/compat";
import { usePill } from "../../shared/pill.styles";
import { SettingsCardTitle } from "../../../settings/settings-card-targets";
import { useCallback } from "react";
import { useT } from "@/shared/i18n";
import { useOnboardingState } from "@/global/onboarding/use-onboarding-state";
import { clearOnboardingChatProgress } from "@/global/onboarding/chat/onboarding-chat-flow";
import { clearPendingHandoff } from "@/global/onboarding/chat/pending-handoff";

export function OnboardingReplayCard() {
  const t = useT();
  const { reset } = useOnboardingState();

  const handleReplay = useCallback(() => {
    clearOnboardingChatProgress();
    clearPendingHandoff();
    reset();
  }, [reset]);

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey="settings.onboardingReplay.title" variant="row" />
        <Button variant="ghost" className="pill-btn" onClick={handleReplay}>
          {t("settings.onboardingReplay.action")}
        </Button>
      </SettingsCardHeader>
      <SettingsCardDesc>
        {t("settings.onboardingReplay.description")}
      </SettingsCardDesc>
    </SettingsCard>
  );
}
