/// <reference path="./natives.d.ts" />
// host/dom (window, document, storage, matchMedia, animation frames) over the app's natives,
// installed before any UI module evaluates: entry.ts imports this ahead of the app, and ES
// module evaluation runs imports in order. Static imports keep the bundle out of Bun's
// lazy-init wrapping, which drops namespace re-exports (zod's `util`).

import "./polyfills";
import "./bun-shim";
import { installDom } from "../../desktop-rune/host/dom";

const env = __native.env;

/** localStorage over the app's own storage (UserDefaults on iOS), so values survive restarts. */
function nativeUiState() {
  // A phone follows the system's light and dark mode until the person picks one (the desktop
  // defaults to dark once onboarding is done).
  if (__native.storageGet("stella-color-mode") === null) __native.storageSet("stella-color-mode", "system");
  return {
    snapshot() {
      const out: Record<string, string> = {};
      for (const k of __native.storageKeys()) {
        const v = __native.storageGet(k);
        if (v !== null) out[k] = v;
      }
      return out;
    },
    apply(changes: Record<string, string | null>) {
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) __native.storageRemove(k);
        else __native.storageSet(k, v);
      }
    },
    clear() { for (const k of __native.storageKeys()) __native.storageRemove(k); },
    onChanged: () => () => {},
  };
}

// A dev sign-in hands the app a one-time token the way the web app gets one (`#ott=`), which
// auth-session.ts redeems at load. Only the dev launch environment sets it.
const ott = env.env.STELLA_OTT;

export const dom = installDom({
  url: `stella-app://mobile/index.html?window=full${ott ? `#ott=${encodeURIComponent(ott)}` : ""}`,
  appearance: { dark: env.dark },
  viewport: { width: env.width, height: env.height, devicePixelRatio: env.scale },
  uiState: nativeUiState(),
  clipboard: {
    // The app reads the system clipboard (UIPasteboard, ClipboardManager) through the engine's `clipboard.read`.
    readText: async () => (await (globalThis as any).stella?.engine?.clipboard.readText().catch(() => "")) ?? "",
    writeText: async (text: string) => { __native.post(JSON.stringify({ cmd: "clipboard.writeText", text })); },
  },
  openExternal: (url: string) => __native.post(JSON.stringify({ cmd: "openURL", url })),
});
