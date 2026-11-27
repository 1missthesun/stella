// The phone app's root. `Root` renders the main window; `initialState` seeds the host store.
// STELLA_PHONE_UI picks the screen while the port is under way: `probe` (first-light checks),
// `desktop` (the desktop Rune UI as is), else the phone shell.
import { Probe } from "./Probe";
import { Root as DesktopRoot } from "../../desktop-rune/ui/App";
import { PhoneRoot } from "./PhoneRoot";

export function initialState() {
  return { error: null, swaps: 0, lastSwapMs: null };
}

const mode = (globalThis as any).__native?.env?.env?.STELLA_PHONE_UI ?? "phone";

export function Root() {
  if (mode === "probe") {
    return (
      <window id="main" bg="#101012">
        <Probe />
      </window>
    );
  }
  if (mode === "desktop") return <DesktopRoot />;
  return <PhoneRoot />;
}
