import { Button, T } from "../../kit/compat";
import { useSelfHost } from "./self-host.styles";
import { usePill } from "../shared/pill.styles";
import { useState } from "react";
import { useT } from "@/shared/i18n";
import { settingsPlace } from "@/global/settings/settings-place";
import { selfHostDialogs, useDesktopServerState } from "@/global/self-host/self-host-store";

export function SelfHostPairScreen() {
  const s = useSelfHost();
  const t = useT();
  const state = useDesktopServerState();
  const [switching, setSwitching] = useState(false);
  return (
    <row {...s.selfHostScreen}>
      <col {...s.selfHostScreenCard}>
        <T role="heading" {...s.selfHostScreenTitle}>
          {t("selfHost.screen.title", { name: state?.name ?? t("selfHost.screen.yourServer") })}
        </T>
        <T w="full" {...s.selfHostDialogText}>{t("selfHost.screen.body", {
          place: settingsPlace(t, "settings.tabs.account", "selfHost.settings.title", "selfHost.settings.connectDevice"),
        })}</T>
        <row {...s.selfHostDialogActions}>
          {state?.canSwitch ? (
            <Button variant="ghost" className="pill-btn" disabled={switching} onClick={() => {
                setSwitching(true);
                void window.electronAPI?.selfHost?.useDefault().then((result) => {
                  if (!result.ok) setSwitching(false);
                });
              }}>
              {t("selfHost.settings.useHosted")}
            </Button>
          ) : null}
          <Button variant="primary" className="pill-btn" onClick={() => selfHostDialogs.openConnect()}>
            {t("selfHost.screen.paste")}
          </Button>
        </row>
      </col>
    </row>
  );
}
