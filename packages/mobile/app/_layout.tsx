import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../src/components/Text";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Stack,
  usePathname,
  useRootNavigationState,
  useRouter,
  type ErrorBoundaryProps,
} from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { recordTouchStart } from "../src/lib/touch-anchor";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { loadAsync, useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { authClient } from "../src/lib/auth-client";
import { setViewsAccount } from "../src/views/views-account";
import { reconnectBackend } from "../src/lib/backend";
import { clearEvidencePreviews } from "../src/lib/chat-evidence-previews";
import { clearFileThumbnails } from "../src/lib/file-thumbnails";
import { clearCloudDriveFileUris } from "../src/lib/use-cloud-drive-file-uri";
import { hasMobileConfig } from "../src/config/env";
import {
  installNotificationCategoriesAndListeners,
  registerForPushNotifications,
  setPushDeliveryOwner,
} from "../src/lib/notifications";
import { selfHostServersAvailable } from "../src/lib/native-capabilities";
import { isSelfHostedLaunch } from "../src/lib/server-registry";
import { currentServerFeatures } from "../src/lib/server-features";
import { ServerStatusGate } from "../src/components/self-host/ServerStatusGate";
import { markSplashHidden } from "../src/lib/splash-state";
import {
  takeMainChatRequest,
  requestedMainTab,
  useMainChatRequested,
} from "../src/lib/main-chat-request";

import { clearLegacyGuestMode } from "../src/lib/guest-mode";
import { loadAiConsent } from "../src/lib/ai-consent";
import { loadNotificationsMuted } from "../src/lib/notifications-prefs";
import { loadVoiceEnabled } from "../src/lib/voice-visibility";
import {
  hasSeenOnboarding,
  loadOnboardingProgress,
  loadOnboardingSeen,
} from "../src/lib/onboarding";
import {
  MAIN_TAB_HREFS,
  enterMainShell,
  loadLastMainTabHref,
  takePendingMainTab,
} from "../src/lib/last-main-tab";
import { observeCloudConversationIdentity } from "../src/lib/cloud-conversation-auth";
import {
  primeCloudConversationAuthority,
  resetCloudConversationAuthority,
  useCloudConversationAuthoritySettled,
} from "../src/lib/use-cloud-canonical-chat-thread";
import {
  criticalStellaFontAssets,
  deferredStellaFontAssets,
} from "../src/theme/fonts";
import { ShareIntentProvider } from "expo-share-intent";
import { ThemeProvider } from "../src/theme/theme-context";
import { ChatSearchProvider } from "../src/lib/chat-search";
import { I18nProvider, useT } from "../src/i18n";
import { ShareIntentHandler } from "../src/lib/share-intent-handler";
import { useSavedValuesSync } from "../src/lib/saved-values";
import { resumeDeviceLinkIfPaired } from "../src/lib/p2p/link";

void SplashScreen.preventAutoHideAsync();

const SPLASH_AUTHORITY_WAIT_MS = 2_500;

const BOOT_CRASH_BREADCRUMB_KEY = "stella-mobile-last-boot-crash-v1";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const t = useT();
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
    const breadcrumb = JSON.stringify({
      at: new Date().toISOString(),
      message: String(error?.message ?? error),
      stack: typeof error?.stack === "string" ? error.stack.slice(0, 4000) : "",
    });
    void AsyncStorage.setItem(BOOT_CRASH_BREADCRUMB_KEY, breadcrumb).catch(
      () => undefined,
    );
  }, [error]);

  return (
    <View style={bootErrorStyles.root}>
      <Text style={bootErrorStyles.title}>{t("mobile.boot.crashTitle")}</Text>
      <Text style={bootErrorStyles.detail} numberOfLines={6}>
        {String(error?.message ?? error)}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={({ pressed }) => [
          bootErrorStyles.button,
          pressed && bootErrorStyles.buttonPressed,
        ]}
      >
        <Text style={bootErrorStyles.buttonLabel}>
          {t("mobile.common.tryAgain")}
        </Text>
      </Pressable>
    </View>
  );
}

const bootErrorStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
    backgroundColor: "#edf3fb",
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1c2733",
    textAlign: "center",
  },
  detail: {
    fontSize: 13,
    color: "#5b6b7b",
    textAlign: "center",
  },
  button: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: "#1c2733",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
});

function RootStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="connect-server" />
      <Stack.Screen name="pair" />
      <Stack.Screen name="p2p" />
      <Stack.Screen name="(main)" />
      <Stack.Screen name="dev-test-session" />
    </Stack>
  );
}

function useBackendFollowsAccount(
  session: ReturnType<typeof authClient.useSession>,
) {
  const account = session.data
    ? `${session.data.user?.id ?? ""}\u0000${session.data.session?.id ?? ""}`
    : null;
  const previous = useRef<string | null | undefined>(undefined);
  const userId = session.data?.user?.id?.trim() || null;
  useEffect(() => {
    if (session.isPending) return;
    // Views keep each account's saved values apart.
    setViewsAccount(userId ? `account:${userId}` : null);
    const before = previous.current;
    previous.current = account;
    if (before !== undefined && before !== account) {
      clearCloudDriveFileUris();
      clearEvidencePreviews();
      clearFileThumbnails();
      reconnectBackend();
    }
  }, [account, session.isPending, userId]);
}

function AuthenticatedLayout({ fontsReady }: { fontsReady: boolean }) {
  const session = authClient.useSession();
  useBackendFollowsAccount(session);
  useSavedValuesSync();
  const router = useRouter();
  const pathname = usePathname();
  const navigatorReady = Boolean(useRootNavigationState()?.key);
  const mainChatRequested = useMainChatRequested();
  const [guestReady, setGuestReady] = useState(false);
  const [initialMainHref, setInitialMainHref] = useState<string | null>(null);
  const splashHiddenRef = useRef(false);
  const legacyGuestSignOutStartedRef = useRef(false);

  useEffect(() => {
    void Promise.all([
      clearLegacyGuestMode(),
      loadAiConsent(),
      loadNotificationsMuted(),
      loadVoiceEnabled(),
      loadOnboardingSeen(),
      loadOnboardingProgress(),
      loadLastMainTabHref(),
    ]).then(([, , , , , , href]) => {
      setInitialMainHref(href);
      setGuestReady(true);
    });
  }, []);

  const legacyGuest =
    (session.data?.user as { isAnonymous?: boolean | null } | undefined)
      ?.isAnonymous === true;
  useEffect(() => {
    if (!legacyGuest || legacyGuestSignOutStartedRef.current) return;
    legacyGuestSignOutStartedRef.current = true;
    void authClient
      .signOut()
      .catch(() => {})
      .finally(() => {
        legacyGuestSignOutStartedRef.current = false;
      });
  }, [legacyGuest]);
  const signedInSession = legacyGuest ? null : (session.data ?? null);

  const cloudIdentity = useMemo(
    () => observeCloudConversationIdentity(signedInSession),
    [signedInSession],
  );
  const cloudIdentityKey = cloudIdentity?.identityKey ?? null;
  useEffect(() => {
    if (session.isPending) return;
    if (!cloudIdentity) {
      resetCloudConversationAuthority();
      return;
    }
    primeCloudConversationAuthority(cloudIdentity);
  }, [cloudIdentity, session.isPending]);

  useEffect(() => {
    void resumeDeviceLinkIfPaired();
  }, []);

  useEffect(() => {
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void installNotificationCategoriesAndListeners().then((unsubscribe) => {
      if (cancelled) {
        unsubscribe();
        return;
      }
      dispose = unsubscribe;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  useEffect(() => {
    if (
      !fontsReady ||
      !navigatorReady ||
      session.isPending ||
      !guestReady ||
      !initialMainHref
    ) {
      return;
    }

    const onLogin = pathname === "/login";
    const onWelcome = pathname === "/welcome";
    const onIndex = pathname === "/" || pathname === "";
    const onOnboarding = pathname === "/onboarding";
    const onServerConnect =
      pathname === "/connect-server" || pathname === "/pair";
    // A computer's Stella over the direct link needs no account, signed in or not.
    const onDirectLink = pathname === "/p2p" || pathname.startsWith("/p2p/");
    const onMain = [
      "/chat",
      "/schedule",
      "/apps",
      "/files",
      "/settings",
      "/cloud-home",
      "/engine-accounts",
    ].some((route) => pathname.startsWith(route));

    if (onOnboarding || onServerConnect || onDirectLink) {
      return;
    }

    const openMainChat = () => {
      if (!takeMainChatRequest()) return false;
      takePendingMainTab();
      router.dismissTo(MAIN_TAB_HREFS[requestedMainTab()], {
        withAnchor: true,
      });
      return true;
    };

    if (signedInSession) {
      const subject = signedInSession.user?.id ?? "";
      const pushOwner = currentServerFeatures().push ? subject : "";
      setPushDeliveryOwner(pushOwner || null);
      if (pushOwner) void registerForPushNotifications(pushOwner);
      if (!hasSeenOnboarding()) {
        router.replace("/onboarding");
        return;
      }
      if (mainChatRequested && openMainChat()) {
        return;
      }
      if (onLogin || onWelcome || onIndex) {
        enterMainShell(router, initialMainHref);
      }
      return;
    }

    setPushDeliveryOwner(null);

    if (isSelfHostedLaunch) {
      router.replace({
        pathname: "/connect-server",
        params: { reason: "signed-out" },
      });
      return;
    }

    if (onMain || onIndex || (mainChatRequested && !onLogin && !onWelcome)) {
      router.replace(selfHostServersAvailable ? "/welcome" : "/login");
    }
  }, [
    fontsReady,
    navigatorReady,
    mainChatRequested,
    pathname,
    router,
    signedInSession,
    session.isPending,
    guestReady,
    initialMainHref,
  ]);

  const authoritySettled =
    useCloudConversationAuthoritySettled(cloudIdentityKey);
  const [authorityWaitExpired, setAuthorityWaitExpired] = useState(false);
  useEffect(() => {
    if (session.isPending || !guestReady || !initialMainHref) return;
    if (authoritySettled || authorityWaitExpired) return;
    const timer = setTimeout(
      () => setAuthorityWaitExpired(true),
      SPLASH_AUTHORITY_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [
    authoritySettled,
    authorityWaitExpired,
    guestReady,
    initialMainHref,
    session.isPending,
  ]);
  useEffect(() => {
    if (splashHiddenRef.current) {
      return;
    }
    if (
      !fontsReady ||
      !navigatorReady ||
      session.isPending ||
      !guestReady ||
      !initialMainHref
    ) {
      return;
    }
    if (!authoritySettled && !authorityWaitExpired) {
      return;
    }
    splashHiddenRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void SplashScreen.hideAsync().finally(markSplashHidden);
      });
    });
  }, [
    fontsReady,
    navigatorReady,
    session.isPending,
    guestReady,
    initialMainHref,
    authoritySettled,
    authorityWaitExpired,
  ]);

  if (!fontsReady) return null;

  return (
    <ServerStatusGate>
      <ShareIntentHandler />
      <RootStack />
    </ServerStatusGate>
  );
}

function AppLayout({ fontsReady }: { fontsReady: boolean }) {
  if (!hasMobileConfig) {
    return (
      <>
        <HideSplashWhenThemed fontsReady={fontsReady} />
        {fontsReady ? <RootStack /> : null}
      </>
    );
  }

  return <AuthenticatedLayout fontsReady={fontsReady} />;
}

function HideSplashWhenThemed({ fontsReady }: { fontsReady: boolean }) {
  useEffect(() => {
    if (!fontsReady) return;
    void SplashScreen.hideAsync().finally(markSplashHidden);
  }, [fontsReady]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(criticalStellaFontAssets);
  const fontsReady = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (!fontsLoaded) {
      return;
    }

    void loadAsync(deferredStellaFontAssets).catch(() => undefined);
  }, [fontsLoaded]);

  return (
    <ShareIntentProvider>
      <GestureHandlerRootView
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={recordTouchStart}
      >
        <SafeAreaProvider>
          <KeyboardProvider>
            <I18nProvider>
              <ThemeProvider>
                <ChatSearchProvider>
                  <AppLayout fontsReady={fontsReady} />
                </ChatSearchProvider>
              </ThemeProvider>
            </I18nProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ShareIntentProvider>
  );
}
