import { useState } from "react";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { selfHostDialogs, useDesktopServerState } from "./self-host-store";
import "./self-host.css";

/**
 * A self-hosted server has no anonymous sign-in: a computer that isn't
 * paired (or was signed out) joins with a new pairing link from the server,
 * or goes back to Stella's own service.
 */
export function SelfHostPairScreen() {
  const t = useT();
  const state = useDesktopServerState();
  const [switching, setSwitching] = useState(false);
  return (
    <div className="self-host-screen" data-testid="self-host-pair-screen">
      <div className="self-host-screen__card">
        <h1 className="self-host-screen__title">
          {t("selfHost.screen.title", { name: state?.name ?? t("selfHost.screen.yourServer") })}
        </h1>
        <p className="self-host-dialog__text">{t("selfHost.screen.body")}</p>
        <div className="self-host-dialog__actions">
          {state?.canSwitch ? (
            <Button
              type="button"
              variant="ghost"
              className="pill-btn"
              disabled={switching}
              onClick={() => {
                setSwitching(true);
                void window.electronAPI?.selfHost?.useDefault().then((result) => {
                  if (!result.ok) setSwitching(false);
                });
              }}
            >
              {t("selfHost.settings.useHosted")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            className="pill-btn"
            onClick={() => selfHostDialogs.openConnect()}
          >
            {t("selfHost.screen.paste")}
          </Button>
        </div>
      </div>
    </div>
  );
}
