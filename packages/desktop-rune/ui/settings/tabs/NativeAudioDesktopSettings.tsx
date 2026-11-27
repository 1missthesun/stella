import { SettingsRow } from "../parts";
import { Press, Switch, T } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { usePill } from "../../global/shared/pill.styles";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useMicrophoneRecovery } from "@/global/permissions/use-microphone-recovery";
import { useT } from "@/shared/i18n";
import {
  loadRealtimeVoiceVisible,
  useRealtimeVoiceVisible,
} from "@/shared/lib/realtime-voice-visibility";

export async function darwinMicrophoneIsDenied(): Promise<boolean> {
  if (window.electronAPI?.platform !== "darwin") return false;
  const status = await window.electronAPI.system.getPermissionStatus?.();
  return status?.microphoneStatus === "denied";
}

export function NativeAudioDesktopRows({
  micEnabled,
  afterWakeWord,
}: {
  micEnabled: boolean;
  afterWakeWord: ReactNode;
}) {
  return (
    <>
      <NativeMicrophoneRecoveryRow />
      <NativeWakeWordRow micEnabled={micEnabled} />
      {afterWakeWord}
      <NativeDictationSoundsRow />
    </>
  );
}

type MicrophonePermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export function NativeMicrophoneRecoveryRow() {
  if (window.electronAPI?.platform !== "darwin") return null;
  return <MacMicrophoneRecoveryRow />;
}

function MacMicrophoneRecoveryRow() {
  const s = useSettings();
  const sPill = usePill();
  const t = useT();
  const microphoneRecovery = useMicrophoneRecovery();
  const [microphoneStatus, setMicrophoneStatus] =
    useState<MicrophonePermissionStatus>("unknown");

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.system.getPermissionStatus?.().then((result) => {
      if (!cancelled && result) setMicrophoneStatus(result.microphoneStatus);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const microphoneDenied = microphoneStatus === "denied";

  return (
    <SettingsRow>
      <col {...s.settingsRowInfo}>
        <T w="full" {...s.settingsRowLabel}>
          {microphoneDenied
            ? t("settings.audio.recovery.recoverLabel")
            : t("settings.audio.recovery.manageLabel")}
        </T>
        <T w="full" {...s.settingsRowSublabel}>
          {microphoneDenied
            ? t("settings.audio.recovery.recoverDescription")
            : t("settings.audio.recovery.manageDescription")}
        </T>
      </col>
      <row {...s.settingsRowControl} {...s.settingsRowControlStacked}>
        <Press {...sPill.pillBtn} disabled={microphoneRecovery.isResetting} onPress={microphoneRecovery.openSettings} {...((microphoneRecovery.isResetting) ? sPill.pillBtnDisabled : null)}>
          {t("settings.audio.recovery.openSettings")}
        </Press>
        <Press {...sPill.pillBtn} {...sPill.pillBtnDanger} {...sPill.pillBtnAfterPill} disabled={microphoneRecovery.isResetting} onPress={() => void microphoneRecovery.resetAndRestart()} {...((microphoneRecovery.isResetting) ? sPill.pillBtnDisabled : null)}>
          {microphoneRecovery.isResetting
            ? t("settings.audio.recovery.closing")
            : t("settings.audio.recovery.reset")}
        </Press>
      </row>
    </SettingsRow>
  );
}

export function NativeWakeWordRow({ micEnabled }: { micEnabled: boolean }) {
  const s = useSettings();
  const t = useT();
  const voiceVisible = useRealtimeVoiceVisible();
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);

  useEffect(() => {
    if (voiceVisible) return;
    let cancelled = false;
    void loadRealtimeVoiceVisible()
      .then(async (visible) => {
        if (cancelled || visible) return;
        const enabled = await window.electronAPI?.system?.getWakeWordEnabled?.();
        if (cancelled || !enabled) return;
        await window.electronAPI?.system?.setWakeWordEnabled?.(false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [voiceVisible]);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.system
      ?.getWakeWordEnabled?.()
      .then((enabled) => {
        if (cancelled) return;
        const nextEnabled = micEnabled && enabled;
        setWakeWordEnabled(nextEnabled);
        if (enabled && !nextEnabled) {
          void window.electronAPI?.system?.setWakeWordEnabled?.(false);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [micEnabled]);

  useEffect(() => {
    if (micEnabled || !wakeWordEnabled) return;
    setWakeWordEnabled(false);
    void window.electronAPI?.system?.setWakeWordEnabled?.(false);
  }, [micEnabled, wakeWordEnabled]);

  const handleWakeWordToggle = useCallback((checked: boolean) => {
    setWakeWordEnabled(checked);
    void window.electronAPI?.system?.setWakeWordEnabled?.(checked).catch(() => {
      setWakeWordEnabled(!checked);
    });
  }, []);

  if (!micEnabled || !voiceVisible) return null;

  return (
    <SettingsRow>
      <col {...s.settingsRowInfo}>
        <T w="full" {...s.settingsRowLabel}>
          {t("settings.audio.wakeWord.label")}
        </T>
        <T w="full" {...s.settingsRowSublabel}>
          {t("settings.audio.wakeWord.description")}
        </T>
      </col>
      <row {...s.settingsRowControl}>
        <Switch checked={wakeWordEnabled} onCheckedChange={handleWakeWordToggle} label={t("settings.audio.wakeWord.label")} hideLabel />
      </row>
    </SettingsRow>
  );
}

export function NativeDictationSoundsRow() {
  const s = useSettings();
  const t = useT();
  const [dictationSoundEffects, setDictationSoundEffects] = useState(true);
  const [savingDictationSoundEffects, setSavingDictationSoundEffects] =
    useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.dictation
      ?.getSoundEffectsEnabled?.()
      .then((enabled) => {
        if (!cancelled) setDictationSoundEffects(enabled !== false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDictationSoundEffectsToggle = useCallback(
    (checked: boolean) => {
      const previous = dictationSoundEffects;
      setDictationSoundEffects(checked);
      setSavingDictationSoundEffects(true);
      void window.electronAPI?.dictation
        ?.setSoundEffectsEnabled?.(checked)
        .then((result) => {
          setDictationSoundEffects(result.enabled);
        })
        .catch(() => {
          setDictationSoundEffects(previous);
        })
        .finally(() => {
          setSavingDictationSoundEffects(false);
        });
    },
    [dictationSoundEffects],
  );

  return (
    <SettingsRow>
      <col {...s.settingsRowInfo}>
        <T w="full" {...s.settingsRowLabel}>
          {t("settings.audio.dictationSounds.label")}
        </T>
        <T w="full" {...s.settingsRowSublabel}>
          {t("settings.audio.dictationSounds.description")}
        </T>
      </col>
      <row {...s.settingsRowControl}>
        <Switch checked={dictationSoundEffects} disabled={savingDictationSoundEffects} onCheckedChange={(checked) =>
            handleDictationSoundEffectsToggle(Boolean(checked))
          } hideLabel />
      </row>
    </SettingsRow>
  );
}
