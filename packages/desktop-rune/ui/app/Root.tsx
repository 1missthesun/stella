import { HostWindows } from "../host/HostWindows";
import type { WindowSnapshot } from "../../host/electron/browser-window";
import { SHELL_TOPBAR_HEIGHT } from "../shell/metrics";
import { FullWindow } from "./FullWindow";
import { AuxWindow } from "./AuxWindow";

const isMac = process.platform === "darwin";

const renderApp = (w: WindowSnapshot) => (w.mode === "full" ? <FullWindow /> : <AuxWindow snapshot={w} />);

const chrome = (w: WindowSnapshot) =>
  w.mode === "full" ? { titlebar: SHELL_TOPBAR_HEIGHT, trafficLights: isMac ? ([16, 13] as [number, number]) : undefined } : undefined;

/** Every window Electron main keeps open: the full shell, companion, overlay, detached viewers and web windows. */
export function Root() {
  if (!stella.host) {
    return (
      <window id="main">
        <FullWindow />
      </window>
    );
  }
  return <HostWindows renderApp={renderApp} chrome={chrome} />;
}
