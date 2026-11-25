import { memo, useMemo, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { WebView } from "react-native-webview";
import { withCanvasPolicy } from "../../lib/canvas-policy";
import { useWebThumbnailSlot } from "../../lib/web-thumbnail-slots";

const PAGE_WIDTH = 390;
const REVEAL_MS = 180;

const VIEWPORT = `<meta name="viewport" content="width=${PAGE_WIDTH}, user-scalable=no"><style>:root{color-scheme:light}html{-webkit-text-size-adjust:100%}::-webkit-scrollbar{display:none}</style>`;
const VIEWPORT_META = /<meta\b[^>]*\bname\s*=\s*["']?viewport\b[^>]*>/gi;

const STILL_AFTER_SETTLING = `(() => {
  const frame = window.requestAnimationFrame.bind(window);
  const every = window.setInterval.bind(window);
  const later = window.setTimeout.bind(window);
  const timers = [];
  let running = true;
  window.requestAnimationFrame = (step) => (running ? frame(step) : 0);
  window.setInterval = (...args) => {
    if (!running) return 0;
    const id = every(...args);
    timers.push(id);
    return id;
  };
  window.setTimeout = (...args) => (running ? later(...args) : 0);
  later(() => {
    running = false;
    for (const id of timers) clearInterval(id);
    const still = document.createElement("style");
    still.textContent = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}";
    (document.head || document.documentElement).appendChild(still);
    for (const media of document.querySelectorAll("video,audio")) media.pause();
  }, 2500);
})();
true;`;

const pageHtml = (html: string): string => {
  const prepared = html.replace(VIEWPORT_META, "");
  const head = /<head(?:\s[^>]*)?>/i.exec(prepared);
  const at = head ? head.index + head[0].length : -1;
  return withCanvasPolicy(
    at < 0
      ? VIEWPORT + prepared
      : prepared.slice(0, at) + VIEWPORT + prepared.slice(at),
  );
};

type WebThumbnailProps =
  | { html: string }
  | { uri: string; crop: DocumentCrop };

/** How far the page runs past its frame: WebKit draws a grey surround around PDFs and slides, lays sheets out far wider than their cells, and stops zooming out before a whole slide fits a tile. */
export type DocumentCrop = {
  zoom: number;
  from: "center" | "start";
  enlarge?: number;
  /** WebKit lays its own page counter over a PDF for this long after loading. */
  revealAfterMs?: number;
};

export const WebThumbnail = memo(function WebThumbnail(
  props: WebThumbnailProps,
) {
  const granted = useWebThumbnailSlot();
  const [failed, setFailed] = useState(false);
  const shown = useSharedValue(0);
  const reveal = useAnimatedStyle(() => ({ opacity: shown.value }));
  const html = "html" in props ? props.html : null;
  const uri = "uri" in props ? props.uri : null;
  const source = useMemo(
    () => (html !== null ? { html: pageHtml(html) } : { uri: uri ?? "" }),
    [html, uri],
  );
  const crop = "uri" in props ? props.crop : null;
  const spare = crop ? (crop.zoom - 1) * 100 : 0;
  const bleed = crop ? (crop.zoom * (crop.enlarge ?? 1) - 1) * 100 : 0;
  const overscan: ViewStyle = crop
    ? {
        height: `${100 + spare}%`,
        left: crop.from === "center" ? `${-bleed / 2}%` : 0,
        position: "absolute",
        top: crop.from === "center" ? `${-bleed / 3}%` : 0,
        transform: [{ scale: crop.enlarge ?? 1 }],
        transformOrigin: "top left",
        width: `${100 + spare}%`,
      }
    : StyleSheet.absoluteFill;
  if (!granted || failed) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, reveal]}
    >
      <View style={overscan}>
        <WebView
          source={source}
          style={styles.page}
          originWhitelist={["*"]}
          allowingReadAccessToURL={uri ?? undefined}
          javaScriptEnabled={uri === null}
          javaScriptCanOpenWindowsAutomatically={false}
          injectedJavaScriptBeforeContentLoaded={STILL_AFTER_SETTLING}
          incognito={uri === null}
          cacheEnabled={false}
          allowFileAccess={uri !== null}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          setSupportMultipleWindows={false}
          geolocationEnabled={false}
          mediaPlaybackRequiresUserAction
          allowsLinkPreview={false}
          dataDetectorTypes="none"
          mixedContentMode="never"
          forceDarkOn={false}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          onShouldStartLoadWithRequest={(request) =>
            request.url === "about:blank" ||
            request.url.startsWith("data:text/html") ||
            (uri !== null && request.url.startsWith("file:"))
          }
          onLoadEnd={() => {
            shown.value = withDelay(
              crop?.revealAfterMs ?? 0,
              withTiming(1, { duration: REVEAL_MS }),
            );
          }}
          onError={() => setFailed(true)}
          onContentProcessDidTerminate={() => setFailed(true)}
          onRenderProcessGone={() => setFailed(true)}
        />
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  page: { backgroundColor: "#ffffff", flex: 1 },
});
