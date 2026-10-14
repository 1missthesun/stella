import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import {
  CameraView,
  scanFromURLAsync,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import {
  parsePairingLink,
  type PairingLink,
  type ServerCompatibility,
  type ServerDiscovery,
} from "@stella/contracts/self-host";
import { Icon } from "../src/components/Icon";
import { makeSelfHostStyles } from "../src/components/self-host/self-host-styles";
import { tapLight, tapMedium } from "../src/lib/haptics";
import { selfHostServersAvailable } from "../src/lib/native-capabilities";
import {
  compatibilityOf,
  fetchServerDiscovery,
} from "../src/lib/server-features";
import {
  HOSTED_SERVER_ID,
  launchServer,
} from "../src/lib/server-registry";
import {
  claimPairingAndSwitch,
  PairingError,
  switchToServer,
} from "../src/lib/server-switch";
import { fadeHex } from "../src/theme/oklch";
import { useColors, useTheme } from "../src/theme/theme-context";
import { useT } from "../src/i18n";

type Step =
  | { kind: "input"; error: string | null }
  | { kind: "checking"; link: PairingLink }
  | {
      kind: "confirm";
      link: PairingLink;
      discovery: ServerDiscovery;
      compatibility: ServerCompatibility;
      error: string | null;
    }
  | { kind: "connecting"; link: PairingLink; discovery: ServerDiscovery };

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/**
 * Connect this phone to a self-hosted Stella server: scan the pairing QR
 * (or pick a photo of it, or paste the link), confirm whose server it is,
 * then claim the one-time code for a session and restart into the server.
 * `?link=` arrives from a `stella://pair` link opened by the camera app.
 */
export default function ConnectServerScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const t = useT();
  const router = useRouter();
  const styles = useMemo(() => makeSelfHostStyles(colors), [colors]);
  const params = useLocalSearchParams<{ link?: string; reason?: string }>();
  const [step, setStep] = useState<Step>({ kind: "input", error: null });
  const [pasted, setPasted] = useState("");
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const handledLinkRef = useRef<string | null>(null);
  const scanLockRef = useRef(false);

  const errorFor = useCallback(
    (error: unknown, host: string): string => {
      if (error instanceof PairingError) {
        switch (error.reason) {
          case "expired":
            return t("mobile.selfHost.errorExpired");
          case "invalid":
            return t("mobile.selfHost.errorInvalid");
          case "too_many_attempts":
            return t("mobile.selfHost.errorAttempts");
          case "rate_limited":
            return t("mobile.selfHost.errorRateLimited");
          case "unreachable":
            return t("mobile.selfHost.unreachable", { host });
          default:
            return t("mobile.selfHost.errorServer");
        }
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "not_a_stella_server" || message.startsWith("no_discovery_")) {
        return t("mobile.selfHost.notStella", { host });
      }
      return t("mobile.selfHost.unreachable", { host });
    },
    [t],
  );

  const startWithLink = useCallback(
    async (raw: string) => {
      const link = parsePairingLink(raw);
      if (!link) {
        setStep({ kind: "input", error: t("mobile.selfHost.invalidLink") });
        return;
      }
      setScanning(false);
      setStep({ kind: "checking", link });
      try {
        const discovery = await fetchServerDiscovery(link.server);
        setStep({
          kind: "confirm",
          link,
          discovery,
          compatibility: compatibilityOf(discovery),
          error: null,
        });
      } catch (error) {
        setStep({ kind: "input", error: errorFor(error, hostOf(link.server)) });
      }
    },
    [errorFor, t],
  );

  // A pairing link opened from outside (camera app, another app).
  useEffect(() => {
    const link = typeof params.link === "string" ? params.link : "";
    if (!link || handledLinkRef.current === link) return;
    handledLinkRef.current = link;
    void startWithLink(link);
  }, [params.link, startWithLink]);

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanLockRef.current) return;
      if (!parsePairingLink(result.data)) return;
      scanLockRef.current = true;
      tapMedium();
      void startWithLink(result.data).finally(() => {
        scanLockRef.current = false;
      });
    },
    [startWithLink],
  );

  const openScanner = async () => {
    tapLight();
    const current = permission?.granted ? permission : await requestPermission();
    if (!current.granted) {
      setStep({ kind: "input", error: t("mobile.selfHost.cameraDenied") });
      return;
    }
    setStep({ kind: "input", error: null });
    setScanning(true);
  };

  const scanPhoto = async () => {
    tapLight();
    setScanning(false);
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    }).catch(() => null);
    const uri = picked && !picked.canceled ? picked.assets[0]?.uri : null;
    if (!uri) return;
    const results = await scanFromURLAsync(uri, ["qr"]).catch(() => []);
    const match = results.find((entry) => parsePairingLink(entry.data));
    if (!match) {
      setStep({ kind: "input", error: t("mobile.selfHost.noCodeInPhoto") });
      return;
    }
    void startWithLink(match.data);
  };

  const pasteFromClipboard = async () => {
    tapLight();
    const text = (await Clipboard.getStringAsync().catch(() => "")).trim();
    if (!text) return;
    setPasted(text);
    if (parsePairingLink(text)) void startWithLink(text);
  };

  const connect = async () => {
    if (step.kind !== "confirm") return;
    tapMedium();
    const { link, discovery } = step;
    setStep({ kind: "connecting", link, discovery });
    try {
      await claimPairingAndSwitch(link, discovery);
    } catch (error) {
      setStep({
        kind: "confirm",
        link,
        discovery,
        compatibility: compatibilityOf(discovery),
        error: errorFor(error, hostOf(link.server)),
      });
    }
  };

  const goBack = () => {
    tapLight();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  if (!selfHostServersAvailable) return <Redirect href="/" />;

  const signedOutHost =
    params.reason === "signed-out" && launchServer.kind === "self-hosted"
      ? hostOf(launchServer.origin)
      : null;
  const signedOutOfActive = signedOutHost !== null;
  const showBack = !signedOutOfActive || router.canGoBack();

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mobile.selfHost.back")}
            hitSlop={10}
            onPress={goBack}
            style={({ pressed }) => [{ padding: 8 }, pressed && styles.textLinkPressed]}
          >
            <Icon name="chevron-left" size={22} color={colors.text} />
          </Pressable>
        ) : null}
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
          {step.kind === "confirm" || step.kind === "connecting" ? (
            <ConfirmStep
              step={step}
              styles={styles}
              colors={colors}
              t={t}
              onConnect={() => void connect()}
              onCancel={() => {
                tapLight();
                setStep({ kind: "input", error: null });
              }}
            />
          ) : (
            <>
              <Text style={[styles.title, { marginTop: 8 }]} accessibilityRole="header">
                {t("mobile.selfHost.connectTitle")}
              </Text>
              {signedOutOfActive ? (
                <View style={styles.notice}>
                  <Icon name="alert-circle" size={18} color={colors.text} />
                  <Text style={styles.noticeText}>
                    {t("mobile.selfHost.sessionEnded", { host: signedOutHost })}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.body}>{t("mobile.selfHost.connectBody")}</Text>

              {scanning ? (
                <View style={styles.camera}>
                  <CameraView
                    style={styles.cameraFill}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={
                      step.kind === "input" ? onBarcodeScanned : undefined
                    }
                  />
                </View>
              ) : null}
              {scanning ? (
                <Text style={styles.small}>{t("mobile.selfHost.cameraHint")}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.selfHost.scanQr")}
                  testID="connect-scan-qr"
                  onPress={() => void openScanner()}
                  disabled={step.kind === "checking"}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { flexDirection: "row", justifyContent: "center", gap: 10 },
                    pressed && styles.primaryButtonPressed,
                    step.kind === "checking" && styles.disabled,
                  ]}
                >
                  <Icon name="camera" size={18} color={colors.accentForeground} />
                  <Text style={styles.primaryButtonText}>
                    {t("mobile.selfHost.scanQr")}
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.selfHost.scanPhoto")}
                testID="connect-scan-photo"
                onPress={() => void scanPhoto()}
                disabled={step.kind === "checking"}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                  step.kind === "checking" && styles.disabled,
                ]}
              >
                <Icon name="image" size={18} color={colors.text} />
                <Text style={styles.secondaryButtonText}>
                  {t("mobile.selfHost.scanPhoto")}
                </Text>
              </Pressable>

              <Text style={styles.label}>{t("mobile.selfHost.pasteLabel")}</Text>
              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel={t("mobile.selfHost.pasteLabel")}
                  testID="connect-link-input"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  onChangeText={setPasted}
                  onSubmitEditing={() => void startWithLink(pasted)}
                  placeholder="stella://pair?…"
                  placeholderTextColor={fadeHex(colors.textMuted, 0.45)}
                  returnKeyType="go"
                  style={[styles.input, { flex: 1 }]}
                  value={pasted}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.selfHost.paste")}
                  testID="connect-paste"
                  onPress={() => void pasteFromClipboard()}
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
                accessibilityLabel={t("mobile.common.continue")}
                testID="connect-continue"
                disabled={!pasted.trim() || step.kind === "checking"}
                onPress={() => void startWithLink(pasted)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.secondaryButtonPressed,
                  (!pasted.trim() || step.kind === "checking") && styles.disabled,
                ]}
              >
                <Text style={styles.secondaryButtonText}>
                  {step.kind === "checking"
                    ? t("mobile.selfHost.checking")
                    : t("mobile.common.continue")}
                </Text>
              </Pressable>

              {step.kind === "input" && step.error ? (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {step.error}
                </Text>
              ) : null}

              {signedOutOfActive ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.selfHost.useStellaInstead")}
                  onPress={() => void switchToServer(HOSTED_SERVER_ID)}
                  style={({ pressed }) => [
                    styles.textLink,
                    pressed && styles.textLinkPressed,
                  ]}
                >
                  <Text style={styles.textLinkText}>
                    {t("mobile.selfHost.useStellaInstead")}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("mobile.selfHost.howToSelfHost")}
                onPress={() => void Linking.openURL("https://stella.sh/self-host.md")}
                style={({ pressed }) => [
                  styles.textLink,
                  pressed && styles.textLinkPressed,
                ]}
              >
                <Text style={styles.textLinkText}>
                  {t("mobile.selfHost.howToSelfHost")}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ConfirmStep({
  step,
  styles,
  colors,
  t,
  onConnect,
  onCancel,
}: {
  step: Extract<Step, { kind: "confirm" } | { kind: "connecting" }>;
  styles: ReturnType<typeof makeSelfHostStyles>;
  colors: ReturnType<typeof useColors>;
  t: ReturnType<typeof useT>;
  onConnect: () => void;
  onCancel: () => void;
}) {
  const host = hostOf(step.link.server);
  const connecting = step.kind === "connecting";
  const compatibility = step.kind === "confirm" ? step.compatibility : "ok";
  const blocked = compatibility !== "ok";
  const error = step.kind === "confirm" ? step.error : null;
  const version = step.discovery.version ?? t("mobile.selfHost.unknownVersion");

  return (
    <>
      <Text style={[styles.title, { marginTop: 8 }]} accessibilityRole="header">
        {t("mobile.selfHost.confirmTitle", { host })}
      </Text>
      <View style={styles.notice}>
        <Icon name="globe" size={18} color={colors.text} />
        <Text style={styles.noticeText} testID="connect-confirm-body">
          {t("mobile.selfHost.confirmBody", { host })}
        </Text>
      </View>
      <View style={styles.card}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t("mobile.selfHost.serverName")}</Text>
          <Text style={styles.detailValue} numberOfLines={1}>
            {step.discovery.name}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t("mobile.selfHost.serverAddress")}</Text>
          <Text style={styles.detailValue} numberOfLines={1}>
            {host}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t("mobile.selfHost.serverVersion")}</Text>
          <Text style={styles.detailValue} numberOfLines={1}>
            {version}
          </Text>
        </View>
      </View>
      {blocked ? (
        <View style={styles.notice}>
          <Icon name="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.noticeText}>
            {compatibility === "server_too_old"
              ? t("mobile.selfHost.confirmServerTooOld")
              : t("mobile.selfHost.confirmAppTooOld")}
          </Text>
        </View>
      ) : null}
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={{ flexGrow: 1 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.selfHost.connectButton")}
        testID="connect-confirm"
        disabled={connecting || blocked}
        onPress={onConnect}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          (connecting || blocked) && styles.disabled,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {connecting
            ? t("mobile.selfHost.connecting")
            : t("mobile.selfHost.connectButton")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.common.cancel")}
        disabled={connecting}
        onPress={onCancel}
        style={({ pressed }) => [
          styles.textLink,
          pressed && styles.textLinkPressed,
          connecting && styles.disabled,
        ]}
      >
        <Text style={styles.textLinkText}>{t("mobile.common.cancel")}</Text>
      </Pressable>
    </>
  );
}
