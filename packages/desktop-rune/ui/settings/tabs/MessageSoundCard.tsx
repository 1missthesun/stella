import { SettingsCard, SettingsCardDesc, SettingsCardHeader, SettingsRow } from "../parts";
import { Button, Play, Select, Switch, T } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { useState } from "react";
import { MESSAGE_SOUNDS, type MessageSound } from "@stella/contracts/message-sound";
import { SettingsCardTitle } from "../settings-card-targets";
import {
  playMessageSound,
  saveMessageSoundPreferences,
  useMessageSoundPreferences,
} from "@/features/chat-alerts/message-sound";
import { useT } from "@/shared/i18n";
import { getSettingsErrorMessage } from "@/global/settings/tabs/shared";

const TITLE_KEY = "settings.messageSound.title";

export function MessageSoundCard() {
  const s = useSettings();
  const t = useT();
  const preferences = useMessageSoundPreferences();
  const [error, setError] = useState<string | null>(null);

  const save = (patch: { enabled?: boolean; sound?: MessageSound }) => {
    setError(null);
    saveMessageSoundPreferences(patch).catch((cause: unknown) => {
      setError(getSettingsErrorMessage(cause, t("settings.errors.saveMessageSound")));
    });
  };

  const options = MESSAGE_SOUNDS.map((sound) => ({
    value: sound,
    label: t(`settings.messageSound.sounds.${sound}`),
  }));

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey={TITLE_KEY} />
        <Switch aria-label={t(TITLE_KEY)} checked={preferences.enabled} onCheckedChange={(next) => save({ enabled: Boolean(next) })} hideLabel />
      </SettingsCardHeader>
      <SettingsCardDesc>{t("settings.messageSound.description")}</SettingsCardDesc>
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>{t("settings.messageSound.sound")}</T>
        </col>
        <row {...s.settingsRowControl}>
          <Button variant="ghost" size="small" aria-label={t("settings.messageSound.preview")} title={t("settings.messageSound.preview")} onClick={() => void playMessageSound(preferences.sound)}>
            <Play size={14} />
          </Button>
          <Select {...s.settingsRuntimeSelect} value={preferences.sound} aria-label={t("settings.messageSound.sound")} disabled={!preferences.enabled} options={options} onValueChange={(sound) => {
              save({ sound });
              void playMessageSound(sound);
            }} />
        </row>
      </SettingsRow>
      {error ? (
        <SettingsCardDesc error role="alert">
          {error}
        </SettingsCardDesc>
      ) : null}
    </SettingsCard>
  );
}
