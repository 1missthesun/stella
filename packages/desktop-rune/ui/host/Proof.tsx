// A root that shows every window Electron main opens: the main window runs the POC app, other app
// windows name their mode, web windows load their page. Run with STELLA_RUNE_APP=ui/host/Proof.tsx.

import type { WindowSnapshot } from "../../host/electron/browser-window";
import { App } from "../App";
import { ThemeProvider, useTokens } from "../theme";
import { HostWindows } from "./HostWindows";

export { initialState, onKey } from "../App";

function AppWindowLabel({ window: w }: { window: WindowSnapshot }) {
  const t = useTokens();
  return (
    <col w="full" h="full" center gap={6} fill={w.transparent ? "#00000000" : t.c.background} windowDrag>
      <text size={15} weight={600} color={t.c.foreground}>{`${w.mode ?? "app"} window`}</text>
      <text size={12} color={t.c.mutedForeground}>{`${w.id} · ${w.windowKind} · ${w.bounds.width}×${w.bounds.height}`}</text>
      {w.frameName ? <text size={12} color={t.c.mutedForeground}>{`opened by ${w.openerId} as "${w.frameName}"`}</text> : null}
    </col>
  );
}

export function Root() {
  return (
    <ThemeProvider>
      <HostWindows renderApp={(w) => (w.engineId === "main" ? <App /> : <AppWindowLabel window={w} />)} />
    </ThemeProvider>
  );
}
