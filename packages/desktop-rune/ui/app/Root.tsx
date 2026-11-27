import { HostWindows } from "../host/HostWindows";
import type { WindowSnapshot } from "../../host/electron/browser-window";
import { SHELL_TOPBAR_HEIGHT } from "../shell/metrics";
import { useScopedWindowKeyProps, useWindowKeyProps } from "../shell/window-keys";
import { useNativeFontSmoothingEnabled } from "@/shared/lib/native-font-smoothing";
import { FullWindow } from "./FullWindow";
import { AuxWindow } from "./AuxWindow";

const isMac = process.platform === "darwin";

const renderApp = (w: WindowSnapshot) => (w.mode === "full" ? <FullWindow /> : <AuxWindow snapshot={w} />);

const isViewerWindow = (w: WindowSnapshot) => w.frameName?.startsWith("stella-viewer-") ?? false;

/** Every window Electron main keeps open: the full shell, companion, overlay and web windows. Detached viewers are drawn by the workspace stage. */
export function Root() {
  const windowKeys = useWindowKeyProps();
  const auxKeys = useScopedWindowKeyProps();
  const fontSmoothing = useNativeFontSmoothingEnabled() ? "antialiased" : "subpixel-antialiased";
  if (!stella.host) {
    return (
      <window id="main" fontSmoothing={fontSmoothing} {...windowKeys}>
        <FullWindow />
      </window>
    );
  }
  return <HostWindows renderApp={renderApp} chrome={(w) => (w.mode === "full" ? { titlebar: SHELL_TOPBAR_HEIGHT, trafficLights: isMac ? [16, 13] : undefined, fontSmoothing, ...windowKeys } : { fontSmoothing, ...auxKeys(w.id) })} skip={isViewerWindow} />;
}
