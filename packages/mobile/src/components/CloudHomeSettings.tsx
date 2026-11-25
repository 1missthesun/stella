import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { GlassToggle } from "./glass";
import {
  Note,
  PrimaryButton as KitPrimaryButton,
  TextAction,
} from "./chat-settings/kit";
import { SettingsScroll } from "./settings/SettingsScroll";
import { PanelPageHeader } from "./sidebar/PanelPageHeader";
import type { CloudConversationIdentity } from "../lib/cloud-conversation-auth";
import { useCloudMemoryPreference } from "../lib/use-cloud-memory-preference";
import { useTelemetryPreference } from "../lib/use-telemetry-preference";
import { type Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors } from "../theme/theme-context";
import { useT } from "../i18n";
import { makeSettingsStyles } from "./settings/settings-styles";

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
  const t = useT();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settingsStyles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const inDrawer = onBack !== undefined;
  const memoryPreference = useCloudMemoryPreference(identity);
  const telemetry = useTelemetryPreference(identity);

  const header = onBack ? (
    <PanelPageHeader
      back={t("mobile.nav.account")}
      onBack={onBack}
      title={t("mobile.cloudHome.title")}
    />
  ) : (
    <View style={styles.pageHeader}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
        {t("mobile.cloudHome.title")}
      </Text>
    </View>
  );

  if (!identity) {
    return (
      <SettingsScroll inDrawer={inDrawer}>
        {header}
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>
            {t("mobile.cloudHome.signInTitle")}
          </Text>
          <Note>{t("mobile.cloudHome.signInBody")}</Note>
          <View style={styles.stateButton}>
            <KitPrimaryButton
              label={t("mobile.cloudHome.signIn")}
              onPress={onSignIn}
            />
          </View>
        </View>
      </SettingsScroll>
    );
  }

  return (
    <SettingsScroll inDrawer={inDrawer}>
      {header}
      <View style={styles.rows}>
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

        <View style={settingsStyles.row}>
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
        <View style={styles.errorBlock}>
          <Note tone="danger">
            {t(
              memoryPreference.issue === "load"
                ? "settings.errors.loadMemory"
                : "settings.errors.saveMemory",
            )}
          </Note>
          <TextAction
            label={t("common.tryAgain")}
            onPress={memoryPreference.retry}
          />
        </View>
      ) : null}
    </SettingsScroll>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    pageHeader: {
      marginBottom: 22,
      paddingTop: 4,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 30,
      letterSpacing: -1,
      lineHeight: 38,
    },
    rows: {
      gap: 20,
    },
    stateBlock: {
      gap: 8,
    },
    stateTitle: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 19,
      letterSpacing: -0.4,
    },
    stateButton: {
      marginTop: 12,
    },
    controlWrap: {
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
    },
    errorBlock: {
      gap: 8,
      marginTop: 20,
    },
  });
