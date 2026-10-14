import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EmailDigest } from "@stella/contracts/backend/email-digest";
import { useLocale, useT } from "../i18n";
import { authClient } from "../lib/auth-client";
import { getBackendClient, useBackendView } from "../lib/backend";
import { tapLight } from "../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { useAppVisible } from "../lib/use-app-visible";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { fadeHex } from "../theme/oklch";
import { useColors } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

const GMAIL_ID = "gmail";
const CONNECT_POLL_MS = 3000;

type Connection = "checking" | "connected" | "disconnected" | "unavailable";

const threadUrl = (threadId: string) =>
  `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;

type Translate = ReturnType<typeof useT>;

const relative = (t: Translate, at: number, now: number): string => {
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return t("shell.emailDigest.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("shell.emailDigest.hoursAgo", { count: hours });
  return t("shell.emailDigest.daysAgo", { count: Math.round(hours / 24) });
};

const clockTime = (locale: string, at: number, now: number): string => {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return new Date(at).toLocaleString(locale, {
    ...(sameDay ? {} : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  });
};

const senderName = (from: string) => from.replace(/\s*<[^>]*>\s*$/u, "").replace(/^"|"$/gu, "");

export function EmailDigestPage() {
  const colors = useColors();
  const t = useT();
  const locale = useLocale();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bottomInset = useSafeAreaInsets().bottom;
  const session = authClient.useSession();
  const signedIn = Boolean(session.data?.user);
  const appVisible = useAppVisible();
  const [connection, setConnection] = useState<Connection>("checking");
  const [waiting, setWaiting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const feed = useBackendView("emailDigest.feed", signedIn ? {} : "skip").value;

  const refresh = useCallback(async () => {
    try {
      const { connected } = await getBackendClient().call("emailDigest.start", {});
      setConnection(connected ? "connected" : "disconnected");
      if (connected) setWaiting(false);
    } catch {
      setConnection("unavailable");
    }
  }, []);

  const liveEnabled = feed?.status.enabled;
  const liveCheckedAt = feed?.status.lastCheckedAt;

  useEffect(() => {
    if (signedIn && appVisible) void refresh();
  }, [appVisible, refresh, signedIn, liveEnabled, liveCheckedAt]);

  useEffect(() => {
    if (!waiting || !appVisible) return;
    const timer = setInterval(() => void refresh(), CONNECT_POLL_MS);
    return () => clearInterval(timer);
  }, [appVisible, refresh, waiting]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [feed]);

  const connect = useCallback(async () => {
    setConnectFailed(false);
    try {
      const { url } = await getBackendClient().call("integrations.connectLink", {
        id: GMAIL_ID,
      });
      await Linking.openURL(url);
      setWaiting(true);
    } catch {
      setConnectFailed(true);
    }
  }, []);

  const checkNow = useCallback(async () => {
    tapLight();
    setChecking(true);
    try {
      await getBackendClient().call("emailDigest.checkNow", {});
    } catch {
      setChecking(false);
      return;
    }
    setChecking(false);
  }, []);

  if (!signedIn) {
    return (
      <View style={styles.root}>
        <EmptyState motif="mail" message={t("mobile.sidebar.signedOutHint")} />
      </View>
    );
  }

  if (connection === "checking" && !feed) {
    return (
      <View style={[styles.centered, { paddingBottom: bottomInset }]}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (connection === "unavailable" && !feed) {
    return (
      <View style={styles.root}>
        <EmptyState
          motif="mail"
          message={t("shell.emailDigest.loadErrorBody")}
          action={{
            label: t("shell.emailDigest.retry"),
            onPress: () => {
              setConnection("checking");
              void refresh();
            },
          }}
        />
      </View>
    );
  }

  if (connection === "disconnected") {
    return (
      <View style={styles.root}>
        <EmptyState
          motif="mail"
          message={
            connectFailed
              ? t("shell.emailDigest.connectError")
              : t("shell.emailDigest.connectBody")
          }
          action={{
            label: waiting
              ? t("shell.emailDigest.connecting")
              : t("shell.emailDigest.connect"),
            onPress: () => void connect(),
          }}
        />
      </View>
    );
  }

  const status = feed?.status;
  const digests = feed?.digests ?? [];
  const running = Boolean(status?.running) || checking;
  const latestDigestAt = digests[0]?.createdAt ?? 0;
  const quiet =
    !running &&
    status?.lastCheckedAt !== undefined &&
    status.lastCheckedAt > latestDigestAt &&
    (status.lastOutcome === "nothing_new" ||
      status.lastOutcome === "nothing_important");

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
      showsVerticalScrollIndicator={false}
      testID="mobile-email-digest"
    >
      <View style={styles.bar}>
        <View style={styles.statusLine}>
          {running ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
          <Text
            style={styles.status}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {running
              ? t("shell.emailDigest.checking")
              : status?.lastCheckedAt !== undefined
                ? t("shell.emailDigest.checked", {
                    when: relative(t, status.lastCheckedAt, now),
                  })
                : t("shell.emailDigest.firstDigest")}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={() => void checkNow()}
          style={({ pressed }) => [
            styles.checkButton,
            pressed && styles.pressed,
            running && styles.disabled,
          ]}
        >
          <Text style={styles.checkLabel} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("shell.emailDigest.checkNow")}
          </Text>
        </Pressable>
      </View>
      {quiet ? (
        <View style={styles.quiet} testID="mobile-email-digest-quiet">
          <Icon name="check" size={14} color={colors.accent} />
          <Text style={styles.quietText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {latestDigestAt > 0
              ? t("shell.emailDigest.nothingNewSince", {
                  time: clockTime(locale, latestDigestAt, now),
                })
              : t("shell.emailDigest.nothingNew")}
          </Text>
        </View>
      ) : null}
      {status?.lastOutcome === "error" && status.lastError && !running ? (
        <View style={styles.quiet}>
          <Text style={styles.errorText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {t("shell.emailDigest.error")}
          </Text>
        </View>
      ) : null}
      {status?.notice && status.lastOutcome !== "error" && !running ? (
        <View style={styles.quiet} testID="mobile-email-digest-notice">
          <Text style={styles.errorText} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {status.notice.kind === "claude_failed"
              ? t("shell.emailDigest.claudeFailed")
              : status.notice.resetsAt !== undefined && status.notice.resetsAt > now
                ? t("shell.emailDigest.claudeLimitUntil", {
                    time: clockTime(locale, status.notice.resetsAt, now),
                  })
                : t("shell.emailDigest.claudeLimit")}
          </Text>
        </View>
      ) : null}
      {digests.map((digest) => (
        <DigestGroup
          key={digest.digestId}
          digest={digest}
          heading={relative(t, digest.createdAt, now)}
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}

function DigestGroup({
  digest,
  heading,
  styles,
}: {
  digest: EmailDigest;
  heading: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.heading} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
        {heading}
      </Text>
      {digest.items.map((item, index) => (
        <Pressable
          key={`${digest.digestId}:${index}`}
          accessibilityRole="button"
          disabled={!item.threadId}
          onPress={() => {
            if (!item.threadId) return;
            tapLight();
            void Linking.openURL(threadUrl(item.threadId)).catch(() => undefined);
          }}
          style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
        >
          <Text style={styles.from} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {senderName(item.from)}
          </Text>
          <Text style={styles.summary} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {item.summary}
          </Text>
          <Text style={styles.subject} numberOfLines={1} maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}>
            {item.subject}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
    },
    content: {
      gap: 4,
      paddingTop: 8,
    },
    centered: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
    bar: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      justifyContent: "space-between",
      minHeight: 36,
      paddingHorizontal: 2,
    },
    statusLine: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 8,
      minWidth: 0,
    },
    status: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    checkButton: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      height: 32,
      justifyContent: "center",
      paddingHorizontal: 14,
    },
    checkLabel: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    pressed: {
      backgroundColor: fadeHex(colors.text, 0.08),
    },
    disabled: {
      opacity: 0.5,
    },
    quiet: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 8,
      marginTop: 6,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    quietText: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 14.5,
      letterSpacing: -0.2,
    },
    errorText: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
    },
    group: {
      gap: 2,
      marginTop: 14,
    },
    heading: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12.5,
      letterSpacing: 0.1,
      marginBottom: 2,
      paddingHorizontal: 2,
    },
    item: {
      borderRadius: 14,
      gap: 2,
      paddingHorizontal: 2,
      paddingVertical: 10,
    },
    itemPressed: {
      backgroundColor: fadeHex(colors.text, 0.06),
    },
    from: {
      color: colors.text,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    summary: {
      color: colors.textBase,
      fontFamily: fonts.sans.regular,
      fontSize: 14.5,
      letterSpacing: -0.1,
      lineHeight: 20,
    },
    subject: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
      letterSpacing: -0.1,
    },
  });
