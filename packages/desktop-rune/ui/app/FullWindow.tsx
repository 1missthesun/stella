import { memo, useEffect, type ReactNode } from "react";
import { BackendAuthProvider } from "@/global/auth/BackendAuthProvider";
import { I18nProvider } from "@/shared/i18n/RemoteI18nProvider";
import { useLocale } from "@/shared/i18n/I18nProvider";
import { localeDir } from "@stella/contracts/locales";
import { BootstrapStateProvider } from "@/bootstrap/bootstrap-state";
import { UiStateProvider } from "@/context/ui-state";
import { CanvasShareProvider } from "@/features/canvas-share/canvas-share-context";
import { VoiceErrorToastListener } from "@/features/voice/runtime/VoiceErrorToastListener";
import { CaptureErrorToastListener } from "@/shell/CaptureErrorToastListener";
import { ChatStoreProvider } from "@/context/chat-store";
import { AppBootstrap } from "@/bootstrap/AppBootstrap";
import { UserAskEventsLayer } from "@/features/user-ask/UserAskEventsLayer";
import { CloudHomeSyncBridge } from "@/features/cloud/CloudHomeSyncBridge";
import { CloudMemoryPreferenceBridge } from "@/features/cloud/CloudMemoryPreferenceBridge";
import { CloudModelSelectionBridge } from "@/features/cloud/CloudModelSelectionBridge";
import { TelemetryPreferenceBridge } from "@/features/cloud/TelemetryPreferenceBridge";
import { SelfHostLayer } from "@/global/self-host/SelfHostLayer";
import { NearbyRequestLayer } from "../global/devices/NearbyRequestLayer";
import { platformCapabilities } from "@/platform/capabilities";
import { prefetchAuthSessionBeforeRender } from "@/global/auth/services/auth-session";
import { installRendererErrorReporting } from "@/platform/diagnostics/report-error";
import { ThemeProvider, useTokens } from "../theme";
import { ToastRegion } from "../kit";
import { ErrorBoundary } from "./ErrorBoundary";
import { mounted, Nothing } from "./mount";
import { FullShell } from "../shell/FullShell";
import { LaunchSplash } from "../shell/LaunchSplash";
import { useNotificationToastSpace } from "../features/notifications/NotificationBell";
import { UpdateTransitionLayer, useUpdateTransitionAppLook } from "../shell/update-transition/UpdateTransitionLayer";
import { ViewsAccountBridge } from "../views/ViewsAccountBridge";

const RemoteExecutionConsentLayer = mounted(import.meta.glob("../replace/global/execution/RemoteExecutionConsentLayer.tsx", { eager: true }), "RemoteExecutionConsentLayer", Nothing);
const DeviceWorkOfferLayer = mounted(import.meta.glob("../replace/global/execution/DeviceWorkOfferLayer.tsx", { eager: true }), "DeviceWorkOfferLayer", Nothing);
const SavedValuesDeviceLayer = mounted(import.meta.glob("../replace/features/saved-values/SavedValuesDeviceLayer.tsx", { eager: true }), "SavedValuesDeviceLayer", Nothing);
const ToastProvider = mounted<{ children: ReactNode }>(import.meta.glob("../replace/ui/toast.tsx", { eager: true }), "ToastProvider", ({ children }) => (
  <>
    {children}
    <AppToastRegion />
  </>
));

function AppToastRegion() {
  return <ToastRegion top={48 + useNotificationToastSpace()} />;
}

const AUTO_REPAIR_SIGNATURE_KEY = "stella:auto-repair:last-signature";

let booted = false;
function bootOnce() {
  if (booted) return;
  booted = true;
  document.documentElement.dataset.stellaWindow = "full";
  installRendererErrorReporting();
  prefetchAuthSessionBeforeRender();
}

/** desktop-ui's `AppProviders` in the same order. */
function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ThemeProvider>
        <ToastProvider>
          {platformCapabilities.nativeBridges ? (
            <>
                <VoiceErrorToastListener />
                <CaptureErrorToastListener />
            </>
          ) : null}
          <BootstrapStateProvider>
            <UiStateProvider>
              <CanvasShareProvider>{children}</CanvasShareProvider>
            </UiStateProvider>
          </BootstrapStateProvider>
        </ToastProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}

/** desktop-ui's `App`: the chat store, bootstrap, the cloud bridges and the execution layers around the full shell. */
function App() {
  const t = useTokens();
  useEffect(() => {
    if (!platformCapabilities.nativeBridges) return;
    const timer = window.setTimeout(() => window.sessionStorage.removeItem(AUTO_REPAIR_SIGNATURE_KEY), 20_000);
    return () => window.clearTimeout(timer);
  }, []);
  const transitionLook = useUpdateTransitionAppLook();
  const dir = localeDir(useLocale());
  return (
    <>
    <col id="app" w="full" h="full" fill={t.c.background} dir={dir} {...transitionLook}>
      <ChatStoreProvider>
        <AppBootstrap />
        <CloudMemoryPreferenceBridge />
        {platformCapabilities.nativeBridges ? <CloudModelSelectionBridge /> : null}
        {platformCapabilities.nativeBridges ? <TelemetryPreferenceBridge /> : null}
        <CloudHomeSyncBridge />
        <UserAskEventsLayer />
        <ViewsAccountBridge />
        {platformCapabilities.nativeBridges ? <RemoteExecutionConsentLayer /> : null}
        {platformCapabilities.nativeBridges ? <DeviceWorkOfferLayer /> : null}
        {platformCapabilities.nativeBridges ? <SavedValuesDeviceLayer /> : null}
        {platformCapabilities.nativeBridges ? <SelfHostLayer /> : null}
        {platformCapabilities.nativeBridges ? <NearbyRequestLayer /> : null}
        <FullShell />
      </ChatStoreProvider>
      <LaunchSplash />
    </col>
    <UpdateTransitionLayer />
    </>
  );
}

/** desktop-ui's `AppRoot` for the full window. */
export const FullWindow = memo(function FullWindow() {
  bootOnce();
  return (
    <ErrorBoundary>
      <BackendAuthProvider enableRuntimeEffects>
        <AppProviders>
          <App />
        </AppProviders>
      </BackendAuthProvider>
    </ErrorBoundary>
  );
});
