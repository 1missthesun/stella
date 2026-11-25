import { SettingsCard, SettingsRow } from "../../settings/parts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, T, showToast } from "../../kit/compat";
import { useSettings } from "../../settings/settings.styles";
import { usePill } from "../shared/pill.styles";
import { SettingsCardTitle } from "../../settings/settings-card-targets";
import { useState } from "react";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import { useT } from "@/shared/i18n";
import { useCloudBrowserActions } from "@/features/cloud/use-cloud-browser-interactions";

function CloudBrowserDataCardImpl() {
  const s = useSettings();
  const t = useT();
  const { resetProfile } = useCloudBrowserActions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resetProfile();
      setConfirming(false);
      showToast({
        title: t("cloudBrowser.settings.resetComplete"),
        variant: "success",
      });
    } catch {
      showToast({
        title: t("cloudBrowser.settings.resetFailed"),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsCard>
        <SettingsCardTitle titleKey="cloudBrowser.settings.title" />
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("cloudBrowser.settings.defaultProfile")}
            </T>
            <T w="full" {...s.settingsRowSublabel}>
              {t("cloudBrowser.settings.description")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn pill-btn--danger" disabled={busy} onClick={() => setConfirming(true)}>
              {busy
                ? t("cloudBrowser.settings.resetting")
                : t("cloudBrowser.settings.reset")}
            </Button>
          </row>
        </SettingsRow>
      </SettingsCard>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cloudBrowser.settings.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("cloudBrowser.settings.confirmBody")}
            </DialogDescription>
          </DialogHeader>
          <row justify="end" gap={8} mt={20}>
            <Button variant="ghost" className="pill-btn" disabled={busy} onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="ghost" className="pill-btn pill-btn--danger" disabled={busy} onClick={() => void reset()}>
              {busy
                ? t("cloudBrowser.settings.resetting")
                : t("cloudBrowser.settings.reset")}
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CloudBrowserDataCard() {
  const { isAuthenticated } = useAuthState();
  return isAuthenticated ? <CloudBrowserDataCardImpl /> : null;
}
