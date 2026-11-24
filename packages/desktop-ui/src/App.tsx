import { useEffect } from "react";
import { AppBootstrap } from "./bootstrap/AppBootstrap";
import { ChatStoreProvider } from "@/context/chat-store";
import { UserAskEventsLayer } from "./features/user-ask/UserAskEventsLayer";
import { RemoteExecutionConsentLayer } from "./global/execution/RemoteExecutionConsentLayer";
import { DeviceWorkOfferLayer } from "./global/execution/DeviceWorkOfferLayer";
import { SavedValuesDeviceLayer } from "./features/saved-values/SavedValuesDeviceLayer";
import { FullShell } from "./shell/FullShell";
import { CloudHomeSyncBridge } from "./features/cloud/CloudHomeSyncBridge";
import { CloudMemoryPreferenceBridge } from "./features/cloud/CloudMemoryPreferenceBridge";
import { CloudModelSelectionBridge } from "./features/cloud/CloudModelSelectionBridge";
import { TelemetryPreferenceBridge } from "./features/cloud/TelemetryPreferenceBridge";
import { platformCapabilities } from "./platform/capabilities";
import { SelfHostLayer } from "./global/self-host/SelfHostLayer";

const AUTO_REPAIR_SIGNATURE_KEY = "stella:auto-repair:last-signature";

function App() {
  useEffect(() => {
    if (!platformCapabilities.nativeBridges) return;
    const timer = window.setTimeout(() => {
      window.sessionStorage.removeItem(AUTO_REPAIR_SIGNATURE_KEY);
    }, 20_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <div className="app window-full">
        <ChatStoreProvider>
          <AppBootstrap />
          <CloudMemoryPreferenceBridge />
          {platformCapabilities.nativeBridges ? (
            <CloudModelSelectionBridge />
          ) : null}
          {platformCapabilities.nativeBridges ? (
            <TelemetryPreferenceBridge />
          ) : null}
          <CloudHomeSyncBridge />
          <UserAskEventsLayer />
          {platformCapabilities.nativeBridges ? (
            <RemoteExecutionConsentLayer />
          ) : null}
          {platformCapabilities.nativeBridges ? <DeviceWorkOfferLayer /> : null}
          {platformCapabilities.nativeBridges ? <SavedValuesDeviceLayer /> : null}
          {platformCapabilities.nativeBridges ? <SelfHostLayer /> : null}
          <FullShell />
        </ChatStoreProvider>
      </div>
    </>
  );
}

export { App };
