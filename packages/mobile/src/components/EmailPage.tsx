import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { getRandomBytes } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import type { EmailPageState } from "@stella/contracts/backend/email";
import type { CanvasActionEvent } from "@stella/contracts/canvas-actions";
import { resolveCanvasLink } from "@stella/contracts/canvas-links";
import {
  EMAIL_PAGE_CANVAS,
  EMAIL_PAGE_FRAME_HTML,
  EMAIL_PAGE_OFF_ACTION,
  EMAIL_PAGE_RULE_REMOVE_PREFIX,
  emailPageActions,
  isEmailPageHostAction,
} from "@stella/contracts/email-page";
import { useLocale, useT } from "../i18n";
import { authClient } from "../lib/auth-client";
import { getBackendClient, useBackendView } from "../lib/backend";
import { canvasBridgeScript, withCanvasPolicy } from "../lib/canvas-policy";
import { useCanvasActionChannel, type CanvasActionOutcome } from "../lib/canvas-actions";
import { markEmailSeen } from "../lib/email";
import type { Colors } from "../theme/colors";
import { useColors, useTheme } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";

const EMAIL_PAGE_IDENTITY = { canvas: EMAIL_PAGE_CANVAS, title: "Email" };

const newToken = (): string =>
  Array.from(getRandomBytes(24), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Removing a rule and turning Email off happen here; every other tap goes to Stella. */
const runHostAction = async (event: CanvasActionEvent): Promise<CanvasActionOutcome> => {
  try {
    if (event.id === EMAIL_PAGE_OFF_ACTION) {
      await getBackendClient().call("email.setEnabled", { enabled: false });
    } else {
      await getBackendClient().call("email.tool", {
        action: "rules",
        op: "remove",
        rule: event.id.slice(EMAIL_PAGE_RULE_REMOVE_PREFIX.length),
      });
    }
    return "sent";
  } catch {
    return "failed";
  }
};

/**
 * The Email page: the frame that ships with Stella (email-page.ts) in a
 * WebView of its own, fed the page Stella keeps. A tap on one of its buttons
 * goes to Stella in the chat as the user's message; the page stays open.
 */
function EmailPageWebView({ state }: { state: EmailPageState }) {
  const colors = useColors();
  const { isDark } = useTheme();
  const locale = useLocale();
  const webViewRef = useRef<WebView>(null);
  const token = useMemo(newToken, []);
  const source = useMemo(() => ({ html: withCanvasPolicy(EMAIL_PAGE_FRAME_HTML) }), []);
  const loadedRef = useRef(false);
  const actions = useMemo(() => emailPageActions(state.page, state.rules), [state.page, state.rules]);
  const data = useMemo(
    () => ({ view: state, theme: isDark ? "dark" : "light", accent: colors.accent, accentFg: colors.accentForeground, locale }),
    [state, isDark, colors.accent, colors.accentForeground, locale],
  );
  const { receiverKey, handleMessage: handleActionMessage, onLoaded } = useCanvasActionChannel({
    webViewRef,
    token,
    actions,
    identity: EMAIL_PAGE_IDENTITY,
    data,
    onAction: (event) => (isEmailPageHostAction(event.id) ? runHostAction(event) : undefined),
  });
  const bridgeScript = useMemo(() => canvasBridgeScript(token, receiverKey), [token, receiverKey]);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(event.nativeEvent.data);
        message = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      } catch {
        return;
      }
      if (!message || handleActionMessage(message)) return;
      if (message.type !== "stella:canvas-navigate" || message.token !== token || typeof message.href !== "string") return;
      const link = resolveCanvasLink(message.href, null);
      if (link.kind === "web" || link.kind === "external") void Linking.openURL(link.url).catch(() => undefined);
    },
    [handleActionMessage, token],
  );
  return (
    <WebView
      ref={webViewRef}
      originWhitelist={["*"]}
      source={source}
      style={{ flex: 1, backgroundColor: "transparent" }}
      testID="mobile-email"
      forceDarkOn={false}
      incognito
      cacheEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      geolocationEnabled={false}
      mixedContentMode="never"
      dataDetectorTypes="none"
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      injectedJavaScriptBeforeContentLoaded={bridgeScript}
      injectedJavaScript={bridgeScript}
      onMessage={handleMessage}
      onLoadEnd={onLoaded}
      onShouldStartLoadWithRequest={(request) => {
        const isPage = request.url === "about:blank" || request.url.startsWith("data:text/html");
        if (!loadedRef.current && isPage && request.isTopFrame !== false) {
          loadedRef.current = true;
          return true;
        }
        return false;
      }}
    />
  );
}

export function EmailPage() {
  const colors = useColors();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bottomInset = useSafeAreaInsets().bottom;
  const signedIn = Boolean(authClient.useSession().data?.user);
  const feed = useBackendView("email.page", signedIn ? {} : "skip");
  const value = feed.value;
  const [waiting, setWaiting] = useState(false);
  // Looking at the page clears the unseen badge, including what changes while it is open.
  useFocusEffect(
    useCallback(() => {
      markEmailSeen();
      return () => markEmailSeen();
    }, []),
  );
  useEffect(() => {
    if (value?.page) markEmailSeen();
  }, [value?.page]);
  const [turningOn, setTurningOn] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const connected = (value?.gmailConnected.length ?? 0) > 0;

  useEffect(() => {
    if (connected) setWaiting(false);
  }, [connected]);

  const connect = useCallback(async () => {
    setConnectFailed(false);
    try {
      const { url } = await getBackendClient().call("integrations.connectLink", { id: "gmail" });
      await Linking.openURL(url);
      setWaiting(true);
    } catch {
      setConnectFailed(true);
    }
  }, []);

  const turnOn = useCallback(async () => {
    setTurningOn(true);
    setTurnOnFailed(false);
    try {
      await getBackendClient().call("email.setEnabled", { enabled: true });
    } catch {
      setTurnOnFailed(true);
    } finally {
      setTurningOn(false);
    }
  }, []);

  if (!signedIn) {
    return (
      <View style={styles.root}>
        <EmptyState motif="mail" message={t("mobile.sidebar.signedOutHint")} />
      </View>
    );
  }

  if (!value) {
    if (feed.error) {
      return (
        <View style={styles.root}>
          <EmptyState motif="mail" message={t("email.section.loadErrorBody")} />
        </View>
      );
    }
    return (
      <View style={[styles.centered, { paddingBottom: bottomInset }]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (!connected) {
    const reconnect = value.needsReconnect;
    return (
      <View style={styles.root}>
        <EmptyState
          motif="mail"
          message={
            connectFailed
              ? t("email.section.connectError")
              : reconnect
                ? t("email.section.reconnectBody")
                : t("email.section.connectBody")
          }
          action={{
            label: waiting
              ? t("email.section.connecting")
              : reconnect
                ? t("email.section.reconnect")
                : t("email.section.connect"),
            onPress: () => void connect(),
          }}
        />
      </View>
    );
  }

  if (!value.enabled) {
    return (
      <View style={styles.root}>
        <EmptyState
          motif="mail"
          message={turnOnFailed ? t("email.failed") : t("email.section.offBody")}
          action={{
            label: turningOn ? t("email.section.turningOn") : t("email.section.turnOn"),
            onPress: () => {
              if (!turningOn) void turnOn();
            },
          }}
        />
      </View>
    );
  }

  return <EmailPageWebView state={value} />;
}

const makeStyles = (_colors: Colors) =>
  StyleSheet.create({
    root: { flex: 1, minHeight: 0 },
    centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  });
