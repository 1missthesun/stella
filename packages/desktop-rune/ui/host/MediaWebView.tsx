// The media page's WebView (host/media/media-page.ts), in its own background window while the
// host wants it: WebKit starts no page and holds back microphone capture and timers in a window
// that is not on screen, and a background window counts as shown without a Stella window open.

import { useSyncExternalStore } from "react";

const MEDIA_WINDOW = "stella-media";
const noSubscribe = () => () => {};
const never = () => false;

const useMediaWanted = () => {
  const media = stella.host?.media;
  return useSyncExternalStore(media ? (l) => media.subscribe(l) : noSubscribe, media ? () => media.wanted() : never);
};

export function MediaWindow() {
  const media = stella.host?.media;
  const wanted = useMediaWanted();
  if (!media || !wanted) return null;
  return (
    <window id={MEDIA_WINDOW} kind="background" title="Stella media" transparent bg="#00000000">
      <webview
        id={media.elementId}
        w="full"
        h="full"
        transparent
        url={media.url}
        protocols={[media.scheme]}
        onRequest={(r) => media.request(r)}
        onMessage={(m) => media.message(m.data)}
        onError={(error) => media.failed(error)}
      />
    </window>
  );
}
