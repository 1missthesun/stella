import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../../src/components/Text";
import { StatusBar } from "expo-status-bar";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StellaMarkHero } from "../../src/components/stella-mark/StellaMarkHero";
import { makeSelfHostStyles } from "../../src/components/self-host/self-host-styles";
import { tapLight } from "../../src/lib/haptics";
import { selfHostServersAvailable } from "../../src/lib/native-capabilities";
import { useColors, useTheme } from "../../src/theme/theme-context";
import { useT } from "../../src/i18n";

export default function WelcomeScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const router = useRouter();
  const styles = useMemo(() => makeSelfHostStyles(colors), [colors]);

  if (!selfHostServersAvailable) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <StellaMarkHero size={76} faceColor={colors.background} />
          <Text style={styles.title} maxFontSizeMultiplier={1.2}>
            {t("mobile.selfHost.welcomeTitle")}
          </Text>
          <Text style={styles.body}>{t("mobile.selfHost.welcomeBody")}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.selfHost.useStella")}
          testID="welcome-use-stella"
          onPress={() => {
            tapLight();
            router.push("/login");
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {t("mobile.selfHost.useStella")}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.selfHost.connectOwn")}
          testID="welcome-connect-own-server"
          onPress={() => {
            tapLight();
            router.push("/connect-server");
          }}
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.secondaryButtonPressed,
          ]}
        >
          <Text style={styles.secondaryButtonText}>
            {t("mobile.selfHost.connectOwn")}
          </Text>
        </Pressable>
        <Text style={[styles.small, { textAlign: "center" }]}>
          {t("mobile.selfHost.connectOwnHint")}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
