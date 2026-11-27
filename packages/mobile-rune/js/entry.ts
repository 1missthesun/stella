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

const t0 = __native.now();

try {
  void listen();
  const env = __native.env;
  onEngineEvent("appearance", (a: any) => {
    dom.setAppearance({ dark: !!a.dark });
    notePhoneAppearance(a);
  });
  const store = createStore((app as any).initialState?.() ?? {});
  (globalThis as any).stella = { store, useStore: makeUseStore(store), command, now, engine, on: onEngineEvent, windowPortal, pressedByKeys, views: createPhoneViews(), phone: { env, post: (m: object) => __native.post(JSON.stringify(m)) } };
  render(createElement(app.Root), { t0: performance.timeOrigin + (t0 - __native.now()) + performance.now() });
  console.info(`[phone] first render ${(__native.now() - t0).toFixed(1)} ms after app start`);
  if (env.env.STELLA_PHONE_UI !== "probe") startPush();
} catch (e) {
  console.error("[phone] boot failed", e);
}
