import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../Icon";
import { makeSelfHostStyles } from "./self-host-styles";
import { tapLight } from "../../lib/haptics";
import {
  refreshActiveServerDiscovery,
  useActiveServerStatus,
} from "../../lib/server-features";
import {
  HOSTED_SERVER_ID,
  isSelfHostedLaunch,
  launchServer,
} from "../../lib/server-registry";
import { switchToServer } from "../../lib/server-switch";
import { markSplashHidden } from "../../lib/splash-state";
import { useColors, useTheme } from "../../theme/theme-context";
import { useT } from "../../i18n";

const APP_STORE_URL = "https://apps.apple.com/app/id6761148311";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.fromyou.stella";

/**
 * On a self-hosted server, check it is a version this app can use (launch
 * and every return to the foreground). Too old, or needing a newer app,
 * replaces the whole app with a screen that says which side to update.
 * Stella's hosted service always passes through untouched.
 */
export function ServerStatusGate({ children }: { children: ReactNode }) {
  const status = useActiveServerStatus();

  useEffect(() => {
    if (!isSelfHostedLaunch) return;
    void refreshActiveServerDiscovery();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshActiveServerDiscovery();
    });
    return () => subscription.remove();
  }, []);

  if (status.state === "server_too_old" || status.state === "app_too_old") {
    return <ServerUpdateScreen kind={status.state} version={status.discovery.version} />;
  }
  return <>{children}</>;
}

function ServerUpdateScreen({
  kind,
  version,
}: {
  kind: "server_too_old" | "app_too_old";
  version: string | null;
}) {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const styles = useMemo(() => makeSelfHostStyles(colors), [colors]);
  const [checking, setChecking] = useState(false);
  const host =
    launchServer.kind === "self-hosted" ? new URL(launchServer.origin).host : "";

  useEffect(() => {
    void SplashScreen.hideAsync().finally(markSplashHidden);
  }, []);

  const checkAgain = async () => {
    tapLight();
    setChecking(true);
    await refreshActiveServerDiscovery();
    setChecking(false);
  };

  const serverTooOld = kind === "server_too_old";

  return (
    <SafeAreaView style={styles.screen} testID="server-update-gate">
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Icon name={serverTooOld ? "refresh-cw" : "download"} size={34} color={colors.text} />
          <Text style={styles.title} accessibilityRole="header">
            {serverTooOld
              ? t("mobile.selfHost.serverTooOldTitle")
              : t("mobile.selfHost.appTooOldTitle")}
          </Text>
          <Text style={styles.body}>
            {serverTooOld
              ? t("mobile.selfHost.serverTooOldBody", { host })
              : t("mobile.selfHost.appTooOldBody", { host })}
          </Text>
          {serverTooOld ? (
            <View style={styles.notice}>
              <Icon name="terminal" size={18} color={colors.text} />
              <Text style={styles.noticeText} selectable>
                {t("mobile.selfHost.serverTooOldHow")}
              </Text>
            </View>
          ) : null}
          {version ? (
            <Text style={styles.small}>
              {t("mobile.selfHost.serverVersionLine", { version })}
            </Text>
          ) : null}
        </View>

        {serverTooOld ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.selfHost.checkAgain")}
            testID="server-update-check-again"
            disabled={checking}
            onPress={() => void checkAgain()}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              checking && styles.disabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {checking ? t("mobile.selfHost.checking") : t("mobile.selfHost.checkAgain")}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.selfHost.openStore")}
            onPress={() =>
              void Linking.openURL(Platform.OS === "ios" ? APP_STORE_URL : PLAY_STORE_URL)
            }
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>{t("mobile.selfHost.openStore")}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.selfHost.useStellaInstead")}
          onPress={() => void switchToServer(HOSTED_SERVER_ID)}
          style={({ pressed }) => [styles.textLink, pressed && styles.textLinkPressed]}
        >
          <Text style={styles.textLinkText}>{t("mobile.selfHost.useStellaInstead")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
