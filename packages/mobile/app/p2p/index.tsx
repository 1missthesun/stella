// "Use your computer's Stella": pairs this phone straight with a computer (QR code, its link, or a
// pasted or typed code) and lists the computers it paired with. Needs no Stella account.
// `stella://p2p?c=<code>` lands here too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import type { P2pComputer } from "@stella/contracts/p2p";
import { Text } from "../../src/components/Text";
import { Icon } from "../../src/components/Icon";
import { makeSelfHostStyles } from "../../src/components/self-host/self-host-styles";
import { tapLight, tapMedium } from "../../src/lib/haptics";
import {
  bootDeviceLink,
  forgetComputer,
  pairWithComputer,
  parsePairInput,
  stellaP2pAvailable,
  useComputers,
} from "../../src/lib/p2p/link";
import { dropComputerChat } from "../../src/lib/p2p/computer-chat";
import { computerStatusKey } from "../../src/lib/p2p/status";
import { fadeHex } from "../../src/theme/oklch";
import { fonts } from "../../src/theme/fonts";
import { useColors, useTheme } from "../../src/theme/theme-context";
import { useT } from "../../src/i18n";

type Step = { kind: "input"; error: string | null } | { kind: "pairing" };

export default function PairComputerScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const router = useRouter();
  const styles = useMemo(() => makeSelfHostStyles(colors), [colors]);
  const params = useLocalSearchParams<{ c?: string }>();
  const { computers } = useComputers();
  const [step, setStep] = useState<Step>({ kind: "input", error: null });
  const [entered, setEntered] = useState("");
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handledLinkRef = useRef<string | null>(null);
  const scanLockRef = useRef(false);

  useEffect(() => {
    void bootDeviceLink().catch(() => undefined);
  }, []);

  const pair = useCallback(
    async (raw: string) => {
      const input = parsePairInput(raw);
      if (!input) {
        setStep({ kind: "input", error: t("mobile.p2p.invalidCode") });
        return;
      }
      setScanning(false);
      setStep({ kind: "pairing" });
      try {
        const computer = await pairWithComputer(input);
        tapMedium();
        setEntered("");
        setStep({ kind: "input", error: null });
        router.replace({ pathname: "/p2p/[id]", params: { id: computer.id } });
      } catch (error) {
        setStep({
          kind: "input",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [router, t],
  );

  useEffect(() => {
    const code = typeof params.c === "string" ? params.c : "";
    if (!code || handledLinkRef.current === code) return;
    handledLinkRef.current = code;
    setEntered(code);
    void pair(code.startsWith("stella://") ? code : `stella://p2p?c=${encodeURIComponent(code)}`);
  }, [params.c, pair]);

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanLockRef.current || !parsePairInput(result.data)) return;
      scanLockRef.current = true;
      tapMedium();
      void pair(result.data).finally(() => {
        scanLockRef.current = false;
      });
    },
    [pair],
  );

  const openScanner = async () => {
    tapLight();
    const current = permission?.granted ? permission : await requestPermission();
    if (!current.granted) {
      setStep({ kind: "input", error: t("mobile.p2p.cameraDenied") });
      return;
    }
    setStep({ kind: "input", error: null });
    setScanning(true);
  };

  const pasteFromClipboard = async () => {
    tapLight();
    const text = (await Clipboard.getStringAsync().catch(() => "")).trim();
    if (!text) return;
    setEntered(text);
    if (parsePairInput(text)) void pair(text);
  };

  const confirmForget = (computer: P2pComputer) => {
    tapLight();
    Alert.alert(
      t("devices.forgetTitle", { name: computer.name }),
      t("devices.forgetBody"),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("devices.forget"),
          style: "destructive",
          onPress: () => {
            void forgetComputer(computer.id)
              .then(() => dropComputerChat(computer.id))
              .catch(() => undefined);
          },
        },
      ],
    );
  };

  const goBack = () => {
    tapLight();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  if (!stellaP2pAvailable) return <Redirect href="/" />;

  const pairing = step.kind === "pairing";

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.common.back")}
          hitSlop={10}
          onPress={goBack}
          style={({ pressed }) => [{ padding: 8 }, pressed && styles.textLinkPressed]}
        >
          <Icon name="chevron-left" size={22} color={colors.text} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.title, { marginTop: 8 }]} accessibilityRole="header">
            {t("mobile.p2p.title")}
          </Text>

          {computers.length > 0 ? (
            <>
              <Text style={styles.label}>{t("mobile.p2p.computers")}</Text>
              <View style={[styles.card, { padding: 0, gap: 0 }]}>
                {computers.map((computer, index) => (
                  <View
                    key={computer.id}
                    style={[
                      rowStyles.row,
                      index > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("devices.computerChat", { name: computer.name })}
                      testID={`p2p-computer-${index}`}
                      onPress={() => {
                        tapLight();
                        router.push({ pathname: "/p2p/[id]", params: { id: computer.id } });
                      }}
                      style={({ pressed }) => [rowStyles.main, pressed && styles.textLinkPressed]}
                    >
                      <View
                        style={[
                          rowStyles.dot,
                          {
                            backgroundColor:
                              computer.link.state === "online"
                                ? colors.ok
                                : fadeHex(colors.textMuted, 0.35),
                          },
                        ]}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={[rowStyles.name, { color: colors.text }]} numberOfLines={1}>
                          {computer.name}
                        </Text>
                        <Text style={[rowStyles.status, { color: colors.textMuted }]} numberOfLines={1}>
                          {t(computerStatusKey(computer))}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={18} color={colors.textMuted} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("devices.more", { name: computer.name })}
                      hitSlop={8}
                      onPress={() => confirmForget(computer)}
                      style={({ pressed }) => [rowStyles.more, pressed && styles.textLinkPressed]}
                    >
                      <Icon name="more-horizontal" size={18} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text style={styles.body}>{t("mobile.p2p.intro")}</Text>

          {scanning ? (
            <View style={styles.camera}>
              <CameraView
                style={styles.cameraFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={pairing ? undefined : onBarcodeScanned}
              />
            </View>
          ) : null}
          {scanning ? (
            <Text style={styles.small}>{t("mobile.selfHost.cameraHint")}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.selfHost.scanQr")}
              testID="p2p-scan-qr"
              onPress={() => void openScanner()}
              disabled={pairing}
              style={({ pressed }) => [
                styles.primaryButton,
                { flexDirection: "row", justifyContent: "center", gap: 10 },
                pressed && styles.primaryButtonPressed,
                pairing && styles.disabled,
              ]}
            >
              <Icon name="camera" size={18} color={colors.accentForeground} />
              <Text style={styles.primaryButtonText}>{t("mobile.selfHost.scanQr")}</Text>
            </Pressable>
          )}

          <Text style={styles.label}>{t("devices.enter.label")}</Text>
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel={t("devices.enter.label")}
              testID="p2p-code-input"
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setEntered}
              onSubmitEditing={() => void pair(entered)}
              placeholder="K7M-49PX"
              placeholderTextColor={fadeHex(colors.textMuted, 0.45)}
              returnKeyType="go"
              style={[styles.input, { flex: 1 }]}
              value={entered}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.selfHost.paste")}
              testID="p2p-paste"
              onPress={() => void pasteFromClipboard()}
              disabled={pairing}
              style={({ pressed }) => [
                styles.secondaryButton,
                { paddingVertical: 0 },
                pressed && styles.secondaryButtonPressed,
              ]}
            >
              <Icon name="copy" size={16} color={colors.text} />
              <Text style={[styles.secondaryButtonText, { fontSize: 15 }]}>
                {t("mobile.selfHost.paste")}
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("devices.enter.connect")}
            testID="p2p-connect"
            disabled={!entered.trim() || pairing}
            onPress={() => void pair(entered)}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.secondaryButtonPressed,
              (!entered.trim() || pairing) && styles.disabled,
            ]}
          >
            <Text style={styles.secondaryButtonText}>
              {pairing ? t("devices.enter.connecting") : t("devices.enter.connect")}
            </Text>
          </Pressable>

          {step.kind === "input" && step.error ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite" testID="p2p-error">
              {step.error}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const rowStyles = {
  row: { flexDirection: "row", alignItems: "center", paddingRight: 8 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingLeft: 18, paddingRight: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontFamily: fonts.sans.semiBold, fontSize: 17, letterSpacing: -0.3 },
  status: { fontFamily: fonts.sans.regular, fontSize: 14 },
  more: { padding: 10 },
} as const;
