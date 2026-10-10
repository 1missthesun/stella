import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassToggle } from "./glass";
import { DestinationList } from "./chat-settings/DestinationList";
import { ProviderList } from "./chat-settings/ProviderList";
import { Rise } from "./sidebar/SidebarNav";
import {
  SIDEBAR_BRAND_ROW,
  SIDEBAR_BRAND_TOP,
  SidebarTopFade,
} from "./sidebar/SidebarPanel";
import { authClient } from "../lib/auth-client";
import { useDrawerOpen, useDrawerSide } from "../lib/drawer";
import { isGuest } from "../lib/guest-mode";
import { useComputerControl } from "../lib/main-shell-store";
import { CONTENT_MAX_FONT_SCALE } from "../lib/setup-text-defaults";
import { useT } from "../i18n";
import type { Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";

/**
 * The chat's own settings, the sidebar on the right of the chat, opened by
 * swiping left or from the gear at the top right.
 *
 * One page in the left sidebar's voice, read top to bottom: where turns run
 * (Cloud and every computer), then which brain runs them (the chosen
 * provider open to its models, thinking and accounts), then the composer
 * shortcut.
 */
export function ChatSettingsPanel({ width }: { width: number }) {
  const colors = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const session = authClient.useSession();
  const computer = useComputerControl();
  const open = useDrawerOpen();
  const active = useDrawerSide() === "end" && open;
  const signedIn = Boolean(session.data?.user) && !isGuest();
  const showDestinations = computer !== null || signedIn;
  let i = 0;

  return (
    <View style={[styles.root, { width }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + 24,
            paddingTop: insets.top + SIDEBAR_BRAND_TOP,
          },
        ]}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Rise i={i++} animated from="end">
          <View style={styles.titleRow}>
            <Text
              accessibilityRole="header"
              style={styles.title}
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              {t("mobile.nav.chatSettingsLabel")}
            </Text>
          </View>
        </Rise>

        {showDestinations ? (
          <Rise i={i++} animated from="end">
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                {t("mobile.settings.computer.sectionLabel")}
              </Text>
              <DestinationList
                control={computer}
                signedIn={signedIn}
                open={active}
              />
            </View>
          </Rise>
        ) : null}

        {computer?.model ? (
          <>
            <Rise i={i++} animated from="end">
              <View style={styles.section}>
                <ProviderList
                  settings={computer.model.settings}
                  active={active}
                  label="Model"
                />
              </View>
            </Rise>

            <Rise i={i++} animated from="end">
              <View style={styles.rule} />
              <View style={styles.toggleRow}>
                <Text
                  style={styles.toggleLabel}
                  maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                >
                  Show in composer
                </Text>
                <GlassToggle
                  value={computer.composerModelPinned}
                  onValueChange={computer.onComposerModelPinnedChange}
                  accessibilityLabel="Show model picker in composer"
                />
              </View>
            </Rise>
          </>
        ) : null}
      </ScrollView>
      <SidebarTopFade />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    root: {
      backgroundColor: colors.background,
      flex: 1,
    },
    content: {
      paddingLeft: 20,
      paddingRight: 28,
    },
    titleRow: {
      height: SIDEBAR_BRAND_ROW,
      justifyContent: "center",
    },
    title: {
      color: colors.text,
      fontFamily: fonts.display.semiBold,
      fontSize: 27,
      letterSpacing: -0.6,
    },
    section: {
      marginTop: 28,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      marginBottom: 2,
    },
    rule: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      marginBottom: 6,
      marginTop: 14,
      opacity: 0.8,
    },
    toggleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 54,
    },
    toggleLabel: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.4,
    },
  });
