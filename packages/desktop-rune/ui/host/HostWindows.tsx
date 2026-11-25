// Electron main's windows as engine `<window>`s. The app root renders `<HostWindows>` and decides
// what an app window shows for its mode; web windows get a `<webview>` on the window's session,
// Chromium pages (in-app browser tabs in a WebContentsView, popups they open) are drawn from their
// frames where main placed them, and every window draws the message boxes main raises for it.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { WindowSnapshot } from "../../host/electron/browser-window";
import { MessageBoxes } from "./MessageBoxes";

const noWindows: WindowSnapshot[] = [];
const noSubscribe = () => () => {};

export function useHostWindows(): WindowSnapshot[] {
  const host = stella.host;
  return useSyncExternalStore(host?.windows.subscribe ?? noSubscribe, host?.windows.snapshot ?? (() => noWindows));
}

export type HostWindowsProps = {
  /** What an app (`stella-app:`) window shows; `null` leaves the window empty. */
  renderApp(window: WindowSnapshot): ReactNode;
  /** Windows to leave out (for example ones the app draws itself). */
  skip?(window: WindowSnapshot): boolean;
  /** Extra `<window>` props for an app window (custom titlebar, traffic-light inset, chrome scheme). */
  chrome?(window: WindowSnapshot): WindowChrome | undefined;
};

export type WindowChrome = { titlebar?: number; trafficLights?: [number, number]; dark?: boolean; keys?: string[]; onKey?: (e: import("../../host/rune-jsx/props").KeyEvent) => void };

export function HostWindows({ renderApp, skip, chrome }: HostWindowsProps) {
  const windows = useHostWindows();
  return (
    <>
      {windows.filter((w) => !w.drawsNothing && !skip?.(w)).map((w) => (
        <HostWindow key={w.id} window={w} chrome={w.kind === "app" ? chrome?.(w) : undefined}>
          {w.browser ? <HostBrowserView contentsId={w.contentsId} w="full" h="full" /> : w.kind === "app" ? renderApp(w) : <HostWebView window={w} />}
        </HostWindow>
      ))}
    </>
  );
}

export function HostWindow({ window: w, chrome, children }: { window: WindowSnapshot; chrome?: WindowChrome; children?: ReactNode }) {
  useEffect(() => {
    stella.host?.mounted(w.engineId);
    return () => stella.host?.unmounted(w.engineId);
  }, [w.engineId]);
  const b = w.bounds;
  return (
    <window
      id={w.engineId}
      kind={w.windowKind}
      title={w.title || "Stella"}
      w={b.width}
      h={b.height}
      position={w.engineId === "main" ? undefined : [b.x, b.y]}
      minSize={w.minWidth || w.minHeight ? [w.minWidth ?? 0, w.minHeight ?? 0] : undefined}
      maxSize={w.maxWidth || w.maxHeight ? [w.maxWidth ?? 100000, w.maxHeight ?? 100000] : undefined}
      resizable={w.resizable}
      frameless={w.frameless}
      transparent={w.transparent}
      alwaysOnTop={w.alwaysOnTop}
      clickThrough={w.ignoreMouseEvents}
      visible={w.visible}
      bg={w.transparent ? "#00000000" : w.backgroundColor}
      {...chrome}
    >
      {children}
      {w.views.filter((v) => v.browser && v.visible && v.bounds.width > 0 && v.bounds.height > 0).map((v) => (
        <HostBrowserView
          key={v.contentsId}
          contentsId={v.contentsId}
          fixed
          absolute={{ left: v.bounds.x, top: v.bounds.y }}
          w={v.bounds.width}
          h={v.bounds.height}
        />
      ))}
      <MessageBoxes windowId={w.id} isMain={w.engineId === "main"} />
    </window>
  );
}

export function HostWebView({ window: w }: { window: WindowSnapshot }) {
  const web = stella.host?.web;
  if (!web || !w.url) return null;
  const id = web.elementId(w.contentsId);
  return (
    <webview
      id={id}
      w="full"
      h="full"
      url={w.url}
      protocols={web.schemes(w.contentsId)}
      onRequest={(r) => web.request(w.contentsId, r)}
      onNavigate={(e) => web.navigated(w.contentsId, e.url, (e as { mainFrame?: boolean }).mainFrame)}
      onTitle={(title) => web.titled(w.contentsId, title)}
      onLoad={(e) => web.loaded(w.contentsId, e.phase)}
      onMessage={(m) => web.message(w.contentsId, m.data)}
    />
  );
}

type BrowserViewLayout = { w: number | "full"; h: number | "full"; fixed?: boolean; absolute?: { left: number; top: number } };

/** A Chromium page drawn from its frames. */
export function HostBrowserView({ contentsId, ...layout }: { contentsId: number } & BrowserViewLayout) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => stella.host?.browser.frames(contentsId, setSrc), [contentsId]);
  return src ? <image src={src} fit="stretch" {...layout} /> : <box fill="#ffffff" {...layout} />;
}
