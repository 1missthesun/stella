import { SettingsCard, SettingsRow } from "../parts";
import { Button, T } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { usePill } from "../../global/shared/pill.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useLocale, useT } from "@/shared/i18n";
import type { MemorySyncStatus } from "@stella/contracts/desktop/memory-sync";
import {
  cloudHomeStatusForAccount,
  cloudHomeSyncRetryStore,
  cloudHomeSyncStatusStore,
} from "@/features/cloud/cloud-home-sync";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import {
  requestMemorySync,
  useMemorySyncStatus,
} from "@/features/cloud/use-memory-sync-status";

type Translate = ReturnType<typeof useT>;

const memorySyncSummary = (
  t: Translate,
  status: MemorySyncStatus | null,
): string => {
  const key = "settings.account.cloudHome.memory";
  switch (status?.phase) {
    case "synced":
      return status.merging > 0 ? t(`${key}.merging`) : t(`${key}.synced`);
    case "syncing":
      return t(`${key}.syncing`);
    case "off":
      return t(`${key}.off`);
    case "held":
      return status.heldReason === "other_account"
        ? t(`${key}.heldOtherAccount`)
        : status.heldReason === "local_choice"
          ? t(`${key}.heldLocal`)
          : t(`${key}.heldWiped`);
    case "error":
      return t(`${key}.error`);
    default:
      return t(`${key}.signedOut`);
  }
};

const syncedAtLabel = (locale: string, at: number): string => {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(
    locale,
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" },
  ).format(at);
};

export function CloudSyncCard() {
  const s = useSettings();
  const t = useT();
  const locale = useLocale();
  const memorySync = useMemorySyncStatus();
  const [isConfirmingCloudHome, setIsConfirmingCloudHome] = useState(false);
  const { accountScope } = useCloudConversationSession();
  const cloudHomeStatusSnapshot = useSyncExternalStore(
    cloudHomeSyncStatusStore.subscribe,
    cloudHomeSyncStatusStore.getSnapshot,
    cloudHomeSyncStatusStore.getServerSnapshot,
  );
  const cloudHomeStatus = cloudHomeStatusForAccount(
    cloudHomeStatusSnapshot,
    accountScope,
  );
  const cloudHomeBusy =
    cloudHomeStatus.phase === "scanning" ||
    cloudHomeStatus.phase === "reconciling";
  const cloudHomeNeedsConfirmation = cloudHomeStatus.issues.some(
    (issue) => issue.code === "import_confirmation_required",
  );
  const cloudHomeOwnerMismatch = cloudHomeStatus.issues.some(
    (issue) => issue.code === "local_owner_mismatch",
  );
  const cloudHomeOwnerInvalid = cloudHomeStatus.issues.some(
    (issue) => issue.code === "local_owner_record_invalid",
  );
  const handleCloudHomeAction = useCallback(async () => {
    if (cloudHomeNeedsConfirmation) {
      setIsConfirmingCloudHome(true);
      try {
        const confirmed =
          await window.electronAPI?.cloudHome.confirmImportOwnership(
            accountScope,
          );
        if (!confirmed) return;
      } finally {
        setIsConfirmingCloudHome(false);
      }
    }
    cloudHomeSyncRetryStore.request();
    void requestMemorySync();
  }, [accountScope, cloudHomeNeedsConfirmation]);
  const cloudHomeSummary = cloudHomeBusy
    ? t("settings.account.cloudHome.summary.checking")
    : cloudHomeStatus.phase === "complete"
      ? t("settings.account.cloudHome.summary.current", {
          skillCount: cloudHomeStatus.skillsUploaded,
        })
      : cloudHomeStatus.phase === "attention"
        ? t("settings.account.cloudHome.summary.attention")
        : cloudHomeStatus.phase === "unavailable"
          ? t("settings.account.cloudHome.summary.unavailable")
          : t("settings.account.cloudHome.summary.intro");

  return (
    <SettingsCard>
      <SettingsCardTitle titleKey="settings.account.cloudHome.title" />
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.memory.title")}
          </T>
          <T w="full" {...s.settingsRowSublabel} role="status">
            {memorySync?.phase === "synced" &&
            memorySync.merging === 0 &&
            memorySync.lastSyncedAt
              ? t("settings.account.cloudHome.memory.lastSynced", {
                  time: syncedAtLabel(locale, memorySync.lastSyncedAt),
                })
              : memorySyncSummary(t, memorySync)}
          </T>
          {memorySync?.phase === "error" && memorySync.failure ? (
            <T w="full" {...s.settingsRowSublabel} role="alert">
              {[
                memorySync.failure.files.length > 0
                  ? t("settings.account.cloudHome.memory.failedFiles", {
                      files: memorySync.failure.files.join(", "),
                    })
                  : null,
                memorySync.failure.code
                  ? `${memorySync.failure.message} (${memorySync.failure.code})`
                  : memorySync.failure.message,
                t("settings.account.cloudHome.memory.nextTry", {
                  time: syncedAtLabel(locale, memorySync.failure.retryAt),
                }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </T>
          ) : null}
          {memorySync && memorySync.refused.length > 0 ? (
            <T w="full" {...s.settingsRowSublabel} role="alert">
              {t("settings.account.cloudHome.memory.refused", {
                files: memorySync.refused.join(", "),
              })}
            </T>
          ) : null}
        </col>
      </SettingsRow>
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.account.cloudHome.skillsLabel")}
          </T>
          <T w="full" {...s.settingsRowSublabel} role="status">
            {cloudHomeSummary}
          </T>
          {cloudHomeStatus.issues.slice(0, 4).map((issue, index) => (
            <T w="full" {...s.settingsRowSublabel} role="alert" key={`${issue.code}:${issue.item ?? "general"}:${index}`}>
              {issue.item ? `${issue.item}: ` : ""}
              {issue.message}
            </T>
          ))}
          {cloudHomeStatus.warnings.slice(0, 3).map((warning, index) => (
            <T w="full" {...s.settingsRowSublabel} key={`${warning.code}:${warning.path}:${index}`}>
              {warning.path}: {warning.message}
            </T>
          ))}
        </col>
        <row {...s.settingsRowControl}>
          <Button variant="ghost" className="pill-btn" onClick={() => void handleCloudHomeAction()} disabled={
              cloudHomeBusy ||
              isConfirmingCloudHome ||
              cloudHomeOwnerMismatch ||
              cloudHomeOwnerInvalid
            }>
            {cloudHomeBusy || isConfirmingCloudHome
              ? t("settings.account.cloudHome.actions.syncing")
              : cloudHomeNeedsConfirmation
                ? t("settings.account.cloudHome.actions.import")
                : cloudHomeOwnerMismatch
                  ? t("settings.account.cloudHome.actions.boundElsewhere")
                  : cloudHomeOwnerInvalid
                    ? t("settings.account.cloudHome.actions.blocked")
                    : t("settings.account.cloudHome.actions.sync")}
          </Button>
        </row>
      </SettingsRow>
    </SettingsCard>
  );
}
