import "./globals";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createStore, makeUseStore } from "../host/store";
import { installSheet } from "./dom/sheet";
import { onEngineEvent, startSelectionEvents, webEngine } from "./engine";

installSheet();
const store = createStore({ dark: true, sidebarOpen: true, messages: [], draft: "", activeChat: "", error: null, swaps: 0, lastSwapMs: null, preview: null });
(globalThis as Record<string, unknown>).stella = {
  store,
  useStore: makeUseStore(store),
  command: () => {},
  now: () => performance.timeOrigin + performance.now(),
  engine: webEngine,
  on: onEngineEvent,
  windowPortal: () => null,
};
startSelectionEvents();

if (import.meta.env.VITE_STELLA_WEB_BUILD === "1") {
  void import("@/platform/web-renderer-switch").then((m) => m.startWebRendererSwitch());
}

const { Root } = await import("../ui/App");
const host = document.getElementById("root")!;
createRoot(host).render(createElement(Root));
requestAnimationFrame(() => {
  const launch = document.getElementById("stella-launch");
  if (!launch) return;
  launch.dataset.exiting = "true";
  setTimeout(() => launch.remove(), 240);
});
