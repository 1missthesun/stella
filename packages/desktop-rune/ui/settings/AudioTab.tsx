import { SettingsCard, SettingsCardDesc, SettingsRow, SettingsTabContent } from "./parts";
import { Select, Switch, T } from "../kit/compat";
import { useSettings } from "./settings.styles";
import { SettingsCardTitle } from "./settings-card-targets";
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { uiState } from "@/platform/ui-state";
import {
  PREFERRED_MIC_KEY,
  PREFERRED_SPEAKER_KEY,
  MIC_ENABLED_KEY,
  isMicrophoneEnabled,
} from "@/features/voice/services/shared-microphone";
import {
  isDictationSuperFastEnabled,
  setDictationSuperFastModeEnabled,
  setDictationSuperFastPreference,
} from "@/features/dictation/services/dictation-session";
import { requestBrowserMicrophoneAccess } from "@/global/permissions/microphone-permission";
import { useT } from "@/shared/i18n";
import { platformCapabilities } from "@/platform/capabilities";
import { SettingsToggleCard } from "./tabs/settings-toggle-card";
import {
  setRealtimeVoiceVisible,
  useRealtimeVoiceVisible,
} from "@/shared/lib/realtime-voice-visibility";

const NativeAudioDesktopRows = lazy(() =>
  import("./tabs/NativeAudioDesktopSettings").then((module) => ({
    default: module.NativeAudioDesktopRows,
  })),
);

const darwinMicrophoneIsDenied = async (): Promise<boolean> => {
  if (!platformCapabilities.nativeSettings) return false;
  const nativeAudio = await import("./tabs/NativeAudioDesktopSettings");
  return nativeAudio.darwinMicrophoneIsDenied();
};

export function AudioTab() {
  const s = useSettings();
  const t = useT();
  const [micEnabled, setMicEnabled] = useState(() => isMicrophoneEnabled());
  const [dictationSuperFast, setDictationSuperFast] = useState(
    () => isMicrophoneEnabled() && isDictationSuperFastEnabled(),
  );
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [audioOutputDevices, setAudioOutputDevices] = useState<
    MediaDeviceInfo[]
  >([]);
  const [selectedMicId, setSelectedMicId] = useState(
    () => uiState.getItem(PREFERRED_MIC_KEY) ?? "",
  );
  const [selectedSpeakerId, setSelectedSpeakerId] = useState(
    () => uiState.getItem(PREFERRED_SPEAKER_KEY) ?? "",
  );
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const voiceEnabled = useRealtimeVoiceVisible();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const micTransactionRef = useRef(0);

  const loadDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(
        (d) => d.kind === "audioinput" && d.deviceId,
      );
      const outputs = devices.filter(
        (d) => d.kind === "audiooutput" && d.deviceId,
      );
      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);
      setPermissionError(null);
    } catch {
      setPermissionError(t("settings.audio.errors.listDevices"));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isMicrophoneEnabled()) {
        await loadDevices();
        return;
      }
      if (isDictationSuperFastEnabled()) {
        setDictationSuperFastPreference(false);
        void setDictationSuperFastModeEnabled(false).catch(() => undefined);
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDevices]);

  const handleMicToggle = useCallback(
    (checked: boolean) => {
      const transaction = ++micTransactionRef.current;

      setMicEnabled(checked);
      uiState.setItem(MIC_ENABLED_KEY, checked ? "true" : "false");

      if (!checked) {
        if (dictationSuperFast) {
          setDictationSuperFast(false);
          setDictationSuperFastPreference(false);
          void setDictationSuperFastModeEnabled(false).catch(() => undefined);
        }
        return;
      }

      void (async () => {
        if (await darwinMicrophoneIsDenied()) {
          if (micTransactionRef.current !== transaction) return;
          setPermissionError(t("settings.audio.errors.micDeniedReset"));
          setMicEnabled(false);
          uiState.setItem(MIC_ENABLED_KEY, "false");
          return;
        }

        try {
          await requestBrowserMicrophoneAccess();
          if (micTransactionRef.current !== transaction) return;
          await loadDevices();
        } catch {
          const deniedReset = await darwinMicrophoneIsDenied();
          if (micTransactionRef.current !== transaction) return;
          setPermissionError(
            deniedReset
              ? t("settings.audio.errors.micDeniedReset")
              : t("settings.audio.errors.micDenied"),
          );
          setMicEnabled(false);
          uiState.setItem(MIC_ENABLED_KEY, "false");
        }
      })();
    },
    [dictationSuperFast, loadDevices, t],
  );

  const handleDictationSuperFastToggle = useCallback((checked: boolean) => {
    setDictationSuperFast(checked);
    setDictationSuperFastPreference(checked);
    void setDictationSuperFastModeEnabled(checked).catch((error: Error) => {
      setPermissionError(error.message);
      setDictationSuperFast(false);
      setDictationSuperFastPreference(false);
    });
  }, []);

  const handleMicChange = useCallback((deviceId: string) => {
    setSelectedMicId(deviceId);
    if (deviceId) {
      uiState.setItem(PREFERRED_MIC_KEY, deviceId);
    } else {
      uiState.removeItem(PREFERRED_MIC_KEY);
    }
  }, []);

  const handleSpeakerChange = useCallback((deviceId: string) => {
    setSelectedSpeakerId(deviceId);
    if (deviceId) {
      uiState.setItem(PREFERRED_SPEAKER_KEY, deviceId);
    } else {
      uiState.removeItem(PREFERRED_SPEAKER_KEY);
    }
  }, []);

  const afterWakeWord = (
    <>
      {micEnabled && audioInputDevices.length > 0 ? (
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("settings.audio.microphone.deviceLabel")}
            </T>
            <T w="full" {...s.settingsRowSublabel}>
              {t("settings.audio.microphone.deviceDescription")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Select {...s.settingsRuntimeSelect} value={selectedMicId} onValueChange={(value) => handleMicChange(value)} aria-label={t("settings.audio.microphone.deviceLabel")} options={[
                { value: "", label: t("settings.audio.systemDefault") },
                ...audioInputDevices.map((device, index) => ({
                  value: device.deviceId,
                  label:
                    device.label ||
                    t("settings.audio.microphoneDeviceFallback", {
                      index: index + 1,
                    }),
                })),
              ]} />
          </row>
        </SettingsRow>
      ) : null}
      {micEnabled ? (
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("settings.audio.superFast.label")}
            </T>
            <T w="full" {...s.settingsRowSublabel}>
              {t("settings.audio.superFast.description")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Switch checked={dictationSuperFast} onCheckedChange={handleDictationSuperFastToggle} hideLabel />
          </row>
        </SettingsRow>
      ) : null}
    </>
  );
  return (
    <SettingsTabContent>
      <SettingsCard>
        <SettingsCardTitle titleKey="settings.audio.microphone.title" />
        {permissionError ? (
          <SettingsCardDesc error role="alert">
            {permissionError}
          </SettingsCardDesc>
        ) : null}
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("settings.audio.microphone.enableLabel")}
            </T>
            <T w="full" {...s.settingsRowSublabel}>
              {t("settings.audio.microphone.enableDescription")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Switch checked={micEnabled} onCheckedChange={handleMicToggle} hideLabel />
          </row>
        </SettingsRow>
        {platformCapabilities.nativeSettings ? (
          <Suspense fallback={null}>
            <NativeAudioDesktopRows micEnabled={micEnabled} afterWakeWord={afterWakeWord} />
          </Suspense>
        ) : (
          afterWakeWord
        )}
      </SettingsCard>

      {platformCapabilities.canSelectSpeaker() ? (
        <SettingsCard>
          <SettingsCardTitle titleKey="settings.audio.speaker.title" />
          {audioOutputDevices.length > 0 ? (
            <SettingsRow>
              <col {...s.settingsRowInfo}>
                <T w="full" {...s.settingsRowLabel}>
                  {t("settings.audio.speaker.outputLabel")}
                </T>
                <T w="full" {...s.settingsRowSublabel}>
                  {t("settings.audio.speaker.outputDescription")}
                </T>
              </col>
              <row {...s.settingsRowControl}>
                <Select {...s.settingsRuntimeSelect} value={selectedSpeakerId} onValueChange={(value) => handleSpeakerChange(value)} aria-label={t("settings.audio.speaker.outputLabel")} options={[
                    { value: "", label: t("settings.audio.systemDefault") },
                    ...audioOutputDevices.map((device, index) => ({
                      value: device.deviceId,
                      label:
                        device.label ||
                        t("settings.audio.speakerDeviceFallback", {
                          index: index + 1,
                        }),
                    })),
                  ]} />
              </row>
            </SettingsRow>
          ) : (
            <SettingsRow>
              <col {...s.settingsRowInfo}>
                <T w="full" {...s.settingsRowSublabel}>
                  {micEnabled
                    ? t("settings.audio.speaker.empty")
                    : t("settings.audio.speaker.emptyMicOff")}
                </T>
              </col>
            </SettingsRow>
          )}
        </SettingsCard>
      ) : null}

      {platformCapabilities.realtimeVoice ? (
        <SettingsToggleCard titleKey="settings.voiceAgent.title" description={t("settings.voiceAgent.description")} error={voiceError} checked={voiceEnabled} disabled={false} onChange={(next) => {
            setVoiceError(null);
            void setRealtimeVoiceVisible(next).catch(() =>
              setVoiceError(t("settings.voiceAgent.error")),
            );
          }} />
      ) : null}
    </SettingsTabContent>
  );
}
