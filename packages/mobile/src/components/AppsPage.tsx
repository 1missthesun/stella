import { useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useIsFocused, useRouter } from "expo-router";
import { useT } from "../i18n";
import { authClient } from "../lib/auth-client";
import { useAppsPage } from "../lib/apps-page-store";
import { startChatWith } from "../lib/ask-stella";
import { useTabBottomInset, useWideLayout } from "../lib/bottom-bar";
import { useEmailUnseenCount } from "../lib/email";
import { useEmailFeature } from "../lib/email-feature";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { MAIN_TAB_HREFS } from "../lib/last-main-tab";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { Text } from "./Text";

export function AppsPage() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const router = useRouter();
  const focused = useIsFocused();
  const bottomInset = useTabBottomInset();
  const wide = useWideLayout();
  const emailOn = useEmailFeature();
  const session = authClient.useSession();
  const page = useAppsPage();

  if (!page) {
    return session.isPending || session.data?.user ? (
      <ActivityIndicator />
    ) : (
      <Text>Apps are unavailable. Please try again.</Text>
    );
  }

  const { apps, error, opening, open } = page;
  const empty = apps?.length === 0 && !error;
  const emailRow =
    emailOn && !wide ? (
      <EmailRow
        styles={styles}
        colors={colors}
        carded={!empty}
        onPress={() => router.push(MAIN_TAB_HREFS.email)}
      />
    ) : null;

  if (empty) {
    return (
      <>
        {emailRow}
        <EmptyState
          motif="apps"
          message={t("mobile.apps.empty")}
          paused={!focused}
          action={{
            label: t("mobile.apps.emptyAction"),
            onPress: () =>
              startChatWith(router, t("mobile.apps.emptyActionPrompt")),
          }}
        />
      </>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.list,
        { paddingBottom: bottomInset + 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {emailRow}
      {apps === null && !error ? <ActivityIndicator /> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.text }}>
          {error}
        </Text>
      ) : null}
      {apps?.map((app) => (
        <Pressable
          key={app.slug}
          accessibilityRole="button"
          accessibilityLabel={app.title}
          accessibilityState={{ busy: opening === app.slug }}
          disabled={opening !== null || app.status !== "ready"}
          onPress={() => open(app)}
          style={[styles.row, styles.card]}
        >
          <Tile styles={styles}>
            {app.icon ? (
              <Text style={styles.emoji} maxFontSizeMultiplier={1}>
                {app.icon}
              </Text>
            ) : (
              <Icon name="apps" size={22} color={colors.text} />
            )}
          </Tile>
          <View style={styles.words}>
            <Text style={styles.title}>{app.title}</Text>
            {app.error ? (
              <Text style={{ color: colors.text }}>{app.error}</Text>
            ) : null}
          </View>
          {opening === app.slug ? <ActivityIndicator /> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Tile({ styles, children }: { styles: Styles; children: ReactNode }) {
  return <View style={styles.tile}>{children}</View>;
}

function EmailRow({
  styles,
  colors,
  carded,
  onPress,
}: {
  styles: Styles;
  colors: Colors;
  carded: boolean;
  onPress: () => void;
}) {
  const t = useT();
  const unseen = useEmailUnseenCount();
  const title = t("email.title");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unseen > 0 ? `${title}, ${unseen}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        carded ? styles.card : styles.plain,
        pressed && styles.pressed,
      ]}
      testID="mobile-apps-email"
    >
      <Tile styles={styles}>
        <Icon name="mail" size={20} color={colors.text} />
      </Tile>
      <View style={styles.words}>
        <Text style={styles.title}>{title}</Text>
        <Text
          style={styles.hint}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {t("mobile.apps.emailHint")}
        </Text>
      </View>
      {unseen > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
            {unseen > 99 ? "99+" : unseen}
          </Text>
        </View>
      ) : null}
      <Icon name="chevron-right" size={15} color={colors.textMuted} />
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: 16, paddingTop: 8 },
    row: { alignItems: "center", flexDirection: "row", gap: 12 },
    card: { backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
    plain: { marginTop: 8, paddingVertical: 10 },
    pressed: { opacity: 0.6 },
    tile: {
      alignItems: "center",
      backgroundColor: colors.surfaceInset,
      borderColor: colors.border,
      borderCurve: "continuous",
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    emoji: { fontSize: 24 },
    words: { flex: 1, gap: 2, minWidth: 0 },
    title: { color: colors.text, fontSize: 17 },
    hint: { color: colors.textMuted, fontSize: 13 },
    badge: {
      alignItems: "center",
      backgroundColor: colors.accent,
      borderRadius: 999,
      height: 20,
      justifyContent: "center",
      minWidth: 20,
      paddingHorizontal: 6,
    },
    badgeText: {
      color: colors.accentForeground,
      fontFamily: fonts.sans.bold,
      fontSize: 12,
    },
  });
