import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./Text";
import { GlassToggle } from "./glass";
import { Icon } from "./Icon";
import { PrimaryButton } from "./PrimaryButton";
import { SettingsScroll } from "./settings/SettingsScroll";
import { SIDEBAR_BRAND_ROW } from "./sidebar/SidebarPanel";
import type { CloudConversationIdentity } from "../lib/cloud-conversation-auth";
import { useCloudMemoryPreference } from "../lib/use-cloud-memory-preference";
import { useTelemetryPreference } from "../lib/use-telemetry-preference";
import { type Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors, useTheme } from "../theme/theme-context";
import { useT } from "../i18n";
import {
  makeSettingsStyles,
  settingsSurfaceFills,
} from "./settings/settings-styles";

type CloudHomeSettingsProps = {
  identity: CloudConversationIdentity | null;
  onSignIn: () => void;
  onBack?: () => void;
};

export function CloudHomeSettings({
  identity,
  onSignIn,
  onBack,
}: CloudHomeSettingsProps) {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const settingsStyles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const inDrawer = onBack !== undefined;
  const memoryPreference = useCloudMemoryPreference(identity);
  const telemetry = useTelemetryPreference(identity);

  const header = (
    <View style={[styles.header, !inDrawer && styles.headerTop]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t("mobile.nav.account")}
          hitSlop={8}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
        >
          <Icon name="chevron-left" size={16} color={colors.textMuted} />
          <Text style={styles.backText}>{t("mobile.nav.account")}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {t("mobile.cloudHome.title")}
      </Text>
    </View>
  );

  if (!identity) {
    return (
      <SettingsScroll inDrawer={inDrawer}>
        {header}
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>
            {t("mobile.cloudHome.signInTitle")}
          </Text>
          <Text style={styles.stateBody}>
            {t("mobile.cloudHome.signInBody")}
          </Text>
          <PrimaryButton
            label={t("mobile.cloudHome.signIn")}
            onPress={onSignIn}
            style={styles.stateButton}
          />
        </View>
      </SettingsScroll>
    );
  }

  return (
    <SettingsScroll inDrawer={inDrawer}>
      {header}
      <View style={settingsStyles.group}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowCopy}>
            <Text style={settingsStyles.rowLabel}>
              {t("settings.memory.title")}
            </Text>
            <Text style={settingsStyles.rowSub}>
              {t("settings.memory.description")}
            </Text>
          </View>
          <View style={styles.controlWrap}>
            {memoryPreference.status === "loading" ||
            memoryPreference.status === "saving" ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : null}
            <GlassToggle
              value={memoryPreference.memoryEnabled}
              disabled={memoryPreference.disabled}
              onValueChange={memoryPreference.setMemoryEnabled}
              accessibilityLabel={t("settings.memory.title")}
            />
          </View>
        </View>

        <View style={[settingsStyles.row, settingsStyles.rowDivider]}>
          <View style={settingsStyles.rowCopy}>
            <Text style={settingsStyles.rowLabel}>
              {t("settings.telemetry.title")}
            </Text>
            <Text style={settingsStyles.rowSub}>
              {t("settings.telemetry.description")}
            </Text>
          </View>
          <View style={styles.controlWrap}>
            {telemetry.loading || telemetry.saving ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : null}
            <GlassToggle
              value={telemetry.enabled}
              disabled={telemetry.loading || telemetry.saving}
              onValueChange={telemetry.setTelemetryEnabled}
              accessibilityLabel={t("settings.telemetry.title")}
            />
          </View>
        </View>
      </View>

      {memoryPreference.issue ? (
        <View style={styles.messageBox}>
          <Text style={styles.errorText}>
            {t(
              memoryPreference.issue === "load"
                ? "settings.errors.loadMemory"
                : "settings.errors.saveMemory",
            )}
          </Text>
          <Pressable
            onPress={memoryPreference.retry}
            accessibilityRole="button"
            accessibilityLabel={t("common.tryAgain")}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>
              {t("common.tryAgain")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </SettingsScroll>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) => {
  const { subtleFill, tonalFill } = settingsSurfaceFills(isDark);
  return StyleSheet.create({
    header: {
      gap: 6,
      marginBottom: 18,
    },
    headerTop: { paddingTop: 4 },
    backBtn: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 4,
      height: SIDEBAR_BRAND_ROW,
      marginLeft: -4,
    },
    backText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    title: {
      color: colors.textStrong,
      fontFamily: fonts.display.semiBold,
      fontSize: 25,
      letterSpacing: -0.9,
    },
    stateBox: {
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 16,
    },
    stateTitle: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
    },
    stateBody: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 13.5,
      lineHeight: 19.5,
      marginTop: 4,
    },
    stateButton: { alignSelf: "flex-start", marginTop: 14 },
    controlWrap: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    pressed: { opacity: 0.6 },
    messageBox: {
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      gap: 10,
      marginTop: 16,
      padding: 14,
    },
    errorText: {
      color: colors.danger,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      lineHeight: 18,
    },
    secondaryButton: {
      alignSelf: "flex-start",
      backgroundColor: tonalFill,
      borderRadius: 9,
      paddingHorizontal: 13,
      paddingVertical: 8,
    },
    secondaryButtonText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 13,
    },
  });
};
