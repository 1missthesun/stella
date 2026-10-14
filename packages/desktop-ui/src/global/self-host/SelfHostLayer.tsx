import { useEffect } from "react";
import { ConnectDeviceDialog } from "./ConnectDeviceDialog";
import { ConnectServerDialog } from "./ConnectServerDialog";
import { selfHostDialogs, useSelfHostDialog } from "./self-host-store";
import { loadServerDiscovery } from "@/platform/backend/server-discovery";

/**
 * Mounted eagerly: a `stella://pair?…` link the OS hands to Stella opens the
 * connect dialog, which asks before anything happens. A link that started
 * Stella waits in main until this layer takes it.
 */
export function SelfHostLayer() {
  const dialog = useSelfHostDialog();

  useEffect(() => {
    void loadServerDiscovery();
    const api = window.electronAPI?.selfHost;
    if (!api) return;
    void api
      .takePendingLink()
      .then((link) => {
        if (link) selfHostDialogs.openConnect(link);
      })
      .catch(() => undefined);
    return api.onPairLink(({ link }) => {
      void api.takePendingLink().catch(() => undefined);
      selfHostDialogs.openConnect(link);
    });
  }, []);

  if (dialog?.kind === "connect") {
    return (
      <ConnectServerDialog
        key={dialog.link ?? "manual"}
        initialLink={dialog.link}
        onClose={() => selfHostDialogs.close()}
      />
    );
  }
  if (dialog?.kind === "device") {
    return <ConnectDeviceDialog onClose={() => selfHostDialogs.close()} />;
  }
  return null;
}
