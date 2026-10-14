import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useState } from "react";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import { selfHostDialogs, useDesktopServerState } from "./self-host-store";

const hostOf = (origin: string | null) => {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

export function ServerSettingsCard() {
  const t = useT();
  const state = useDesktopServerState();
  const [switching, setSwitching] = useState(false);
  if (!state || (!state.canSwitch && !state.selfHosted)) return null;

  const useDefault = async () => {
    setSwitching(true);
    const result = await window.electronAPI?.selfHost?.useDefault();
    if (!result?.ok) {
      setSwitching(false);
      showToast({
        title: t("selfHost.settings.switchFailed"),
        description: result && !result.ok ? result.error : undefined,
        variant: "error",
      });
    }
  };

  return (
    <div className="settings-card" data-testid="self-host-server-card">
      <SettingsCardTitle titleKey="selfHost.settings.title" />
      <div className="settings-row">
        <div className="settings-row-info">
          <div className="settings-row-label">
            {state.selfHosted
              ? (state.name ?? hostOf(state.backendUrl))
              : t("selfHost.settings.hostedName")}
          </div>
          <div className="settings-row-sublabel">
            {state.selfHosted
              ? t("selfHost.settings.selfHostedDesc", { host: hostOf(state.backendUrl) })
              : t("selfHost.settings.hostedDesc")}
          </div>
        </div>
        <div className="settings-row-control">
          {state.selfHosted ? (
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              onClick={() => selfHostDialogs.openDevice()}
            >
              {t("selfHost.settings.connectDevice")}
            </Button>
          ) : null}
        </div>
      </div>
      {state.canSwitch ? (
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">
              {state.selfHosted
                ? t("selfHost.settings.otherServerLabel")
                : t("selfHost.settings.ownServerLabel")}
            </div>
            <div className="settings-row-sublabel">{t("selfHost.settings.ownServerDesc")}</div>
          </div>
          <div className="settings-row-control">
            {state.selfHosted ? (
              <Button
                type="button"
                variant="ghost"
                className="pill-btn"
                disabled={switching}
                onClick={() => void useDefault()}
              >
                {switching ? t("selfHost.settings.switching") : t("selfHost.settings.useHosted")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              disabled={switching}
              onClick={() => selfHostDialogs.openConnect()}
            >
              {t("selfHost.settings.connect")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
