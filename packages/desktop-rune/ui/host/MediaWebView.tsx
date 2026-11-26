// The media page's WebView (host/media/media-page.ts): mounted while the host wants it, one
// transparent pixel in a window on screen, because WebKit holds back microphone capture and
// timers in a hidden page.

import { useSyncExternalStore } from "react";
import type { WindowSnapshot } from "../../host/electron/browser-window";

const noSubscribe = () => () => {};
const never = () => false;

const useMediaWanted = () => {
  const media = stella.host?.media;
  return useSyncExternalStore(media ? (l) => media.subscribe(l) : noSubscribe, media ? () => media.wanted() : never);
};

/** The window that holds the media page while it is wanted: the main window when it shows, else another window on screen. */
export function useMediaWindow(windows: readonly WindowSnapshot[]): string | null {
  const wanted = useMediaWanted();
  const media = stella.host?.media;
  if (!media || !wanted) return null;
  const visible = windows.filter((w) => w.visible).sort((a, b) => Number(b.engineId === "main") - Number(a.engineId === "main"));
  return media.windowFor(visible.map((w) => w.engineId));
}

export function MediaWebView() {
  const media = stella.host?.media;
  const wanted = useMediaWanted();
  if (!media || !wanted) return null;
  return (
    <webview
      id={media.elementId}
      w={1}
      h={1}
      transparent
      fixed
      absolute={{ left: 0, top: 0 }}
      url={media.url}
      protocols={[media.scheme]}
      onRequest={(r) => media.request(r)}
      onMessage={(m) => media.message(m.data)}
      onError={(error) => media.failed(error)}
    />
  );
}
