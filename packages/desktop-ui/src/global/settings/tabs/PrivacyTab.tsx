import { lazy, Suspense, useState } from "react";
import { useUiState } from "@/context/ui-state";
import {
  useChatStorageMode,
  setChatStorageMode,
} from "@/features/chat/services/chat-storage-preference";
import { useCloudMemoryPreference } from "@/features/cloud/use-cloud-memory-preference";
import { useLocalMemoryPreference } from "@/features/cloud/use-local-memory-preference";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { CloudAccountCards } from "@/features/cloud/CloudAccountCards";
import { CloudMemoryWipeSettings } from "@/features/cloud/CloudMemoryWipeSettings";
import { CloudMemoryReimportSettings } from "@/features/cloud/CloudMemoryReimportSettings";
import { useT } from "@/shared/i18n";
import { platformCapabilities } from "@/platform/capabilities";
import { SettingsToggleCard } from "./settings-toggle-card";
import { CloudSyncCard } from "./CloudSyncCard";
import { TelemetrySettingsCard } from "./TelemetrySettingsCard";
import { AnonymousCountsSettingsCard } from "./AnonymousCountsSettingsCard";
import { GoogleConnectionCard } from "./GoogleConnectionCard";
import { YourDataCard } from "./YourDataCard";

const NativePermissionSettings = lazy(() =>
  import("./NativePermissionSettings").then((module) => ({
    default: module.NativePermissionSettings,
  })),
);

const NativeLockedComputerUseCard = lazy(() =>
  import("./NativeGeneralSettings").then((module) => ({
    default: module.NativeLockedComputerUseCard,
  })),
);

export function PrivacyTab() {
  const t = useT();
  const storageMode = useChatStorageMode();
  const { state: uiState } = useUiState();
  const [storageError, setStorageError] = useState<string | null>(null);
  const [savingStorage, setSavingStorage] = useState(false);
  const memoryPreference = useCloudMemoryPreference();
  const session = useAuthSessionState();
  const signedOut = !session.isLoading && !session.hasSession;
  const localMemory = useLocalMemoryPreference(signedOut);
  const showLocalMemory = signedOut && localMemory.available;
  const { isCloudConversationReady, accountScope, identityRevision } =
    useCloudConversationSession();

  return (
    <div className="settings-tab-content">
      {platformCapabilities.nativeSettings ? (
        <SettingsToggleCard
          titleKey="settings.chatStorage.title"
          description={t("settings.chatStorage.description")}
          checked={storageMode === "cloud"}
          disabled={savingStorage || uiState.isVoiceRtcActive}
          error={
            storageError ??
            (uiState.isVoiceRtcActive
              ? t("settings.chatStorage.endVoice")
              : null)
          }
          onChange={(enabled) => {
            setSavingStorage(true);
            setStorageError(null);
            void setChatStorageMode(enabled ? "cloud" : "local")
              .catch(() => setStorageError(t("settings.chatStorage.error")))
              .finally(() => setSavingStorage(false));
          }}
        />
      ) : null}
      {showLocalMemory ? (
        <SettingsToggleCard
          titleKey="settings.memory.title"
          description={t("settings.memory.description")}
          error={localMemory.failed ? t("settings.errors.saveMemory") : null}
          checked={localMemory.memoryEnabled}
          disabled={localMemory.loading || localMemory.saving}
          onChange={(checked) => void localMemory.setMemoryEnabled(checked)}
        />
      ) : (
        <SettingsToggleCard
          titleKey="settings.memory.title"
          description={t("settings.memory.description")}
          error={
            memoryPreference.issue
              ? t(
                  memoryPreference.issue === "load"
                    ? "settings.errors.loadMemory"
                    : "settings.errors.saveMemory",
                )
              : null
          }
          checked={memoryPreference.memoryEnabled}
          disabled={
            memoryPreference.disabled || memoryPreference.status === "error"
          }
          onChange={(checked) => void memoryPreference.setMemoryEnabled(checked)}
          retry={
            memoryPreference.issue
              ? () => void memoryPreference.retry()
              : undefined
          }
          retryLabel={t("common.tryAgain")}
        />
      )}
      {window.electronAPI?.cloudHome ? <CloudSyncCard /> : null}
      {window.electronAPI?.cloudHome && isCloudConversationReady ? (
        <CloudMemoryReimportSettings
          key={`memory-reimport:${accountScope}:${identityRevision}`}
        />
      ) : null}
      {isCloudConversationReady ? (
        <CloudMemoryWipeSettings
          key={`memory-wipe:${accountScope}:${identityRevision}`}
        />
      ) : null}
      <YourDataCard />
      <GoogleConnectionCard />
      {platformCapabilities.nativeSettings ? <TelemetrySettingsCard /> : null}
      {platformCapabilities.nativeSettings ? <AnonymousCountsSettingsCard /> : null}
      <CloudAccountCards />
      {platformCapabilities.nativeSettings ? (
        <Suspense fallback={null}>
          <NativePermissionSettings />
          <NativeLockedComputerUseCard />
        </Suspense>
      ) : null}
    </div>
  );
}
