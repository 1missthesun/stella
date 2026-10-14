import { useEffect } from "react";
import { ConnectDeviceDialog } from "./ConnectDeviceDialog";
import { ConnectServerDialog } from "./ConnectServerDialog";
import { selfHostDialogs, useSelfHostDialog } from "./self-host-store";
import { ManagedModelsFallback } from "./ManagedModelsFallback";
import {
  loadServerDiscovery,
  useSelfHostedServer,
  useServerDiscovery,
  useServerFeature,
} from "@/platform/backend/server-discovery";

export function SelfHostLayer() {
  const dialog = useSelfHostDialog();
  const selfHosted = useSelfHostedServer();
  const discovered = useServerDiscovery() !== null;
  const managedModels = useServerFeature("managedModels");
  const fallback = selfHosted && discovered && !managedModels ? <ManagedModelsFallback /> : null;

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
      <>
        {fallback}
        <ConnectServerDialog
          key={dialog.link ?? "manual"}
          initialLink={dialog.link}
          onClose={() => selfHostDialogs.close()}
        />
      </>
    );
  }
  if (dialog?.kind === "device") {
    return (
      <>
        {fallback}
        <ConnectDeviceDialog onClose={() => selfHostDialogs.close()} />
      </>
    );
  }
  return fallback;
}
