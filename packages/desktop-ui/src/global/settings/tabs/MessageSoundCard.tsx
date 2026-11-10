import { useState } from "react";
import { MESSAGE_SOUNDS, type MessageSound } from "@stella/contracts/message-sound";
import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import {
  playMessageSound,
  saveMessageSoundPreferences,
  useMessageSoundPreferences,
} from "@/features/chat-alerts/message-sound";
import { useT } from "@/shared/i18n";
import { Button } from "@/ui/button";
import { Play } from "@/ui/icons";
import { Select } from "@/ui/select";
import { Switch } from "@/ui/switch";
import { getSettingsErrorMessage } from "./shared";

const TITLE_KEY = "settings.messageSound.title";

export function MessageSoundCard() {
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
    <div className="settings-card">
      <div className="settings-card-header">
        <SettingsCardTitle titleKey={TITLE_KEY} />
        <Switch
          aria-label={t(TITLE_KEY)}
          checked={preferences.enabled}
          onCheckedChange={(next) => save({ enabled: Boolean(next) })}
          hideLabel
        />
      </div>
      <p className="settings-card-desc">{t("settings.messageSound.description")}</p>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-label">{t("settings.messageSound.sound")}</div>
        </div>
        <div className="settings-row-control">
          <Button
            variant="ghost"
            size="small"
            aria-label={t("settings.messageSound.preview")}
            title={t("settings.messageSound.preview")}
            onClick={() => void playMessageSound(preferences.sound)}
          >
            <Play size={14} aria-hidden="true" />
          </Button>
          <Select<MessageSound>
            className="settings-runtime-select"
            value={preferences.sound}
            aria-label={t("settings.messageSound.sound")}
            disabled={!preferences.enabled}
            options={options}
            onValueChange={(sound) => {
              save({ sound });
              void playMessageSound(sound);
            }}
          />
        </div>
      </div>
      {error ? (
        <p className="settings-card-desc settings-card-desc--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
