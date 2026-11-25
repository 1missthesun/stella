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
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";
import { useAiryList } from "./airy-list";
import { Dot, Hairline } from "./chat-settings/kit";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { Text } from "./Text";

export function AppsPage() {
  const colors = useColors();
  const styles = useAiryList();
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
      <ActivityIndicator color={colors.textMuted} style={local.loading} />
    ) : (
      <Text style={styles.detail}>Apps are unavailable. Please try again.</Text>
    );
  }

  const { apps, error, opening, open } = page;
  const empty = apps?.length === 0 && !error;
  const email =
    emailOn && !wide ? (
      <EmailEntry onPress={() => router.push(MAIN_TAB_HREFS.email)} />
    ) : null;

  if (empty) {
    return (
      <>
        {email}
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
      style={local.screen}
      contentContainerStyle={{ paddingBottom: bottomInset + 32 }}
      showsVerticalScrollIndicator={false}
    >
      {email}
      {email && apps ? <Hairline space={16} /> : <View style={local.lead} />}
      {apps === null && !error ? (
        <ActivityIndicator color={colors.textMuted} style={local.loading} />
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.detail, styles.danger, local.error]}
        >
          {error}
        </Text>
      ) : null}
      {apps?.map((app) => {
        const ready = app.status === "ready";
        return (
          <Pressable
            key={app.slug}
            accessibilityRole="button"
            accessibilityLabel={app.title}
            accessibilityState={{ busy: opening === app.slug, disabled: !ready }}
            disabled={opening !== null || !ready}
            onPress={() => open(app)}
            style={({ pressed }) => [
              styles.row,
              local.row,
              pressed && styles.pressed,
            ]}
            testID={`mobile-app-${app.slug}`}
          >
            <View style={local.glyph}>
              {app.icon ? (
                <Text style={local.emoji} maxFontSizeMultiplier={1}>
                  {app.icon}
                </Text>
              ) : (
                <Icon name="apps" size={26} color={colors.text} />
              )}
            </View>
            <View style={styles.copy}>
              <Text
                style={[styles.title, !ready && styles.quiet]}
                numberOfLines={1}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                {app.title}
              </Text>
              {app.error ? (
                <Text
                  style={[styles.detail, styles.danger]}
                  numberOfLines={3}
                  maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                >
                  {app.error}
                </Text>
              ) : null}
            </View>
            {opening === app.slug ? (
              <ActivityIndicator color={colors.textMuted} />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function EmailEntry({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  const styles = useAiryList();
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
        local.email,
        pressed && styles.pressed,
      ]}
      testID="mobile-apps-email"
    >
      <View style={local.glyph}>
        <Icon name="mail" size={27} color={colors.text} />
      </View>
      <View style={styles.copy}>
        <View style={local.emailLine}>
          <Text
            style={[local.emailTitle, { color: colors.text }]}
            numberOfLines={1}
            maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
          >
            {title}
          </Text>
          {unseen > 0 ? <Dot /> : null}
        </View>
      </View>
      {unseen > 0 ? (
        <Text style={styles.trailing} maxFontSizeMultiplier={1.2}>
          {unseen > 99 ? "99+" : unseen}
        </Text>
      ) : null}
    </Pressable>
  );
}

const local = StyleSheet.create({
  screen: { flex: 1 },
  lead: { height: 8 },
  loading: { marginTop: 32 },
  error: { paddingVertical: 12 },
  row: { minHeight: 66 },
  glyph: { alignItems: "center", justifyContent: "center", width: 36 },
  emoji: { fontSize: 30, lineHeight: 38 },
  email: { marginTop: 10, minHeight: 72 },
  emailLine: { alignItems: "center", flexDirection: "row", gap: 10 },
  emailTitle: {
    flexShrink: 1,
    fontFamily: fonts.sans.bold,
    fontSize: 28,
    letterSpacing: -1,
    lineHeight: 34,
  },
});
