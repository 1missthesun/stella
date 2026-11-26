import { SettingsCard, SettingsCardDesc, SettingsRow } from "../parts";
import { Button, T, showToast } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { usePill } from "../../global/shared/pill.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { useCallback, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useT } from "@/shared/i18n";

export function YourDataCard() {
  const s = useSettings();
  const t = useT();
  const { isCloudConversationReady } = useCloudConversationSession();
  const preferences = useBackendValue(
    "preferences.get",
    isCloudConversationReady ? {} : "skip",
  );
  const [exporting, setExporting] = useState(false);
  const [supportSaving, setSupportSaving] = useState(false);
  const [support, setSupport] = useState<{
    until: number | null;
    log: { at: number; action: string; tool?: string }[];
  } | null>(null);

  const until = support?.until ?? preferences?.supportAccessUntil ?? null;
  const log = support?.log ?? preferences?.supportAccessLog ?? [];

  const download = useCallback(() => {
    setExporting(true);
    void (async () => {
      try {
        const [data, listing] = await Promise.all([
          backendClient.call("data.export", {}),
          backendClient
            .call("memory.files.list", {})
            .catch(() => null),
        ]);
        const memoryFiles: { path: string; content: string }[] = [];
        if (listing) {
          for (const file of listing.files) {
            const read = await backendClient
              .call("memory.files.read", {
                expectedMemoryEpoch: listing.memoryEpoch,
                path: file.path,
              })
              .catch(() => null);
            if (read) memoryFiles.push({ path: file.path, content: read.content });
          }
        }
        const payload = {
          exportedAt: new Date(data.exportedAt).toISOString(),
          truncated: data.truncated,
          preferences: preferences ?? null,
          memoryFiles,
          conversations: data.conversations,
        };
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
          }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "stella-data-export.json";
        anchor.click();
        URL.revokeObjectURL(url);
        showToast(t("settings.yourData.exportDone"));
      } catch {
        showToast(t("settings.yourData.exportError"));
      } finally {
        setExporting(false);
      }
    })();
  }, [preferences, t]);

  const setGrant = useCallback(
    (grant: boolean) => {
      setSupportSaving(true);
      void backendClient
        .call(grant ? "support.grant" : "support.revoke", {})
        .then((result) =>
          setSupport({
            until: result.supportAccessUntil,
            log: result.supportAccessLog,
          }),
        )
        .catch(() => showToast(t("settings.yourData.supportError")))
        .finally(() => setSupportSaving(false));
    },
    [t],
  );

  if (!isCloudConversationReady) return null;

  return (
    <SettingsCard>
      <SettingsCardTitle titleKey="settings.yourData.title" />
      <SettingsCardDesc>
        {t("settings.yourData.description")}
      </SettingsCardDesc>
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.yourData.exportLabel")}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <Button variant="ghost" className="pill-btn" disabled={exporting} onClick={download}>
            {exporting
              ? t("settings.yourData.exporting")
              : t("settings.yourData.exportAction")}
          </Button>
        </row>
      </SettingsRow>
      <SettingsRow>
        <col {...s.settingsRowInfo}>
          <T w="full" {...s.settingsRowLabel}>
            {t("settings.yourData.supportLabel")}
          </T>
          <T w="full" {...s.settingsRowSublabel}>
            {until
              ? `${t("settings.yourData.supportActive")} ${new Date(until).toLocaleString()}`
              : t("settings.yourData.supportOff")}
          </T>
        </col>
        <row {...s.settingsRowControl}>
          <Button variant="ghost" className="pill-btn" disabled={supportSaving} onClick={() => setGrant(!until)}>
            {until
              ? t("settings.yourData.supportRevoke")
              : t("settings.yourData.supportGrant")}
          </Button>
        </row>
      </SettingsRow>
      {log.length > 0 ? (
        <SettingsCardDesc>
          {[...log]
            .reverse()
            .slice(0, 5)
            .map(
              (entry) =>
                `${new Date(entry.at).toLocaleString()} · ${
                  entry.action === "granted"
                    ? t("settings.yourData.logGranted")
                    : entry.action === "revoked"
                      ? t("settings.yourData.logRevoked")
                      : `${t("settings.yourData.logAccessed")}${entry.tool ? ` (${entry.tool})` : ""}`
                }`,
            )
            .join("\n")}
        </SettingsCardDesc>
      ) : null}
    </SettingsCard>
  );
}
