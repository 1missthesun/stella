// Quitting ends what the app started. A terminate or interrupt runs main's own quit (its before-quit
// and will-quit cleanups), and quitting asks the runtime worker to quit with the app instead of
// idling 10 s for a client that isn't coming back; a relaunch keeps it for the next process.

import { app } from "../electron/app";
import { stopAllChromium } from "../electron/chromium";
import { mainContext } from "./main-context";

const SIGNAL_QUIT_DEADLINE_MS = 8_000;
const RUNTIME_EXIT_TIMEOUT_MS = 3_000;

type Runner = { stop(options: { shutdownRuntime?: boolean; quit?: boolean; exitTimeoutMs?: number }): Promise<void> };

export function installQuitHandling() {
  const state = mainContext()?.state as { processRuntime?: { registerCleanup(phase: string, key: string, run: () => Promise<void>): void }; stellaHostRunner?: Runner | null } | undefined;
  state?.processRuntime?.registerCleanup("before-quit", "rune-runtime-quit", async () => {
    const { isRelaunching } = require("../../../desktop/electron/launcher-client.ts") as { isRelaunching(): boolean };
    if (isRelaunching()) return;
    await state.stellaHostRunner?.stop({ shutdownRuntime: true, quit: true, exitTimeoutMs: RUNTIME_EXIT_TIMEOUT_MS });
  });

  app.on("will-quit", () => stopAllChromium());

  let signalled = false;
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (signalled) return;
      signalled = true;
      setTimeout(() => process.exit(0), SIGNAL_QUIT_DEADLINE_MS).unref();
      app.quit();
    });
  }
}
