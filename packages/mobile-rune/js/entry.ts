/// <reference path="./natives.d.ts" />
// The phone's JS entry, the counterpart of the desktop host's host/app.tsx (without services
// and file watching): the bridge and reconciler of packages/desktop-rune/host over the app's
// natives, host/dom for desktop-ui's logic (boot-dom.ts, first), then the phone app (ui/App.tsx).

import { dom } from "./boot-dom";
import { createElement } from "react";
import { command, engine, listen, now, onEngineEvent } from "../../desktop-rune/host/bridge";
import { pressedByKeys, render, windowPortal } from "../../desktop-rune/host/reconciler";
import { createStore, makeUseStore } from "../../desktop-rune/host/store";
import * as app from "../ui/App";
import { notePhoneAppearance } from "../ui/phone/insets";
import { createPhoneViews } from "./views";
import { startPush } from "../ui/native/push";
import { installBackButton } from "../ui/phone/back";
import { restoreComputerMode } from "../ui/computer/computer-mode";
import { listenForPairingLinks } from "../ui/computer/ConnectComputer";
import { installJsPerf } from "./jsperf";
import { phoneConversationCache } from "./conversation-cache";
import { phoneChatEvidence } from "./chat-evidence";

const t0 = __native.now();

try {
  void listen();
  const env = __native.env;
  if (env.env.STELLA_JSPERF === "1") installJsPerf();
  // The chat's cache of the last session (what Electron's SQLite store is on a computer), so a
  // launch shows the latest messages at once and syncs on top.
  const conversationCache = phoneConversationCache();
  (globalThis as { __stellaConversationCache?: unknown }).__stellaConversationCache = conversationCache;
  // The preview cards under a reply for its Drive pictures, videos and pages.
  (globalThis as { __stellaChatEvidence?: unknown }).__stellaChatEvidence = phoneChatEvidence;
  onEngineEvent("appearance", (a: any) => {
    dom.setAppearance({ dark: !!a.dark });
    notePhoneAppearance(a);
  });
  // Backgrounding and coming back, as a browser tab's visibility and focus: the chat socket
  // checks itself and reconnects on `visibilitychange` (use-conversation), timers catch up.
  onEngineEvent("app.visible", ({ visible }) => {
    if (!visible) conversationCache.flush();
    dom.setVisible(visible);
    dom.setFocused(visible);
  });
  const store = createStore((app as any).initialState?.() ?? {});
  (globalThis as any).stella = { store, useStore: makeUseStore(store), command, now, engine, on: onEngineEvent, windowPortal, pressedByKeys, views: createPhoneViews(), phone: { env, post: (m: object) => __native.post(JSON.stringify(m)) } };
  installBackButton();
  // The direct device link: a computer the phone was using opens again, and its links pair.
  if (env.env.STELLA_PHONE_UI !== "probe") {
    restoreComputerMode();
    listenForPairingLinks();
  }
  render(createElement(app.Root), { t0: performance.timeOrigin + (t0 - __native.now()) + performance.now() });
  console.info(`[phone] first render ${(__native.now() - t0).toFixed(1)} ms after app start`);
  // Dev launches can pass STELLA_PUSH=0 to leave notifications alone (no permission prompt).
  if (env.env.STELLA_PHONE_UI !== "probe" && env.env.STELLA_PUSH !== "0") startPush();
} catch (e) {
  console.error("[phone] boot failed", e);
}
