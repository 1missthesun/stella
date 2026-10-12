import { useCallback, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { Button } from "@/ui/button";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";

/**
 * What Stella Cloud holds for this account, in one place: download it, and
 * the support-access grant (off unless the owner turns it on for a day,
 * with every use recorded below). Everything else about privacy here is
 * on by default and needs no switch.
 */
export function YourDataCard() {
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
    <div className="settings-card">
      <h3 className="settings-card-title">{t("settings.yourData.title")}</h3>
      <p className="settings-card-desc">
        {t("settings.yourData.description")}
      </p>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-label">
            {t("settings.yourData.exportLabel")}
          </div>
        </div>
        <div className="settings-row-control">
          <Button
            type="button"
            variant="ghost"
            className="pill-btn"
            disabled={exporting}
            onClick={download}
          >
            {exporting
              ? t("settings.yourData.exporting")
              : t("settings.yourData.exportAction")}
          </Button>
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-label">
            {t("settings.yourData.supportLabel")}
          </div>
          <div className="settings-card-desc">
            {until
              ? `${t("settings.yourData.supportActive")} ${new Date(until).toLocaleString()}`
              : t("settings.yourData.supportOff")}
          </div>
        </div>
        <div className="settings-row-control">
          <Button
            type="button"
            variant="ghost"
            className="pill-btn"
            disabled={supportSaving}
            onClick={() => setGrant(!until)}
          >
            {until
              ? t("settings.yourData.supportRevoke")
              : t("settings.yourData.supportGrant")}
          </Button>
        </div>
      </div>
      {log.length > 0 ? (
        <p className="settings-card-desc">
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
        </p>
      ) : null}
    </div>
  );
}
