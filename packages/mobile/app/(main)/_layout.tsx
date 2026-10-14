import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import type { ActivityIndicatorEntry } from "@stella/contracts/activity-indicator";
import {
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  usePathname,
  useRouter,
} from "expo-router";
import { PersistentAppsHost } from "../../src/components/PersistentAppsHost";
import { AiConsentModal } from "../../src/components/AiConsentModal";
import {
  grantAiConsent,
  hasAiConsent,
  subscribeAiConsentRequested,
} from "../../src/lib/ai-consent";
import { authClient } from "../../src/lib/auth-client";
import { tearDownPushNotifications } from "../../src/lib/notifications";
import { useReportTimeZone } from "../../src/lib/schedule-zone";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Icon } from "../../src/components/Icon";
import { GlassIconButton } from "../../src/components/GlassIconButton";
import { StellaStatusHeader } from "../../src/components/StellaStatusHeader";
import { StellaActivityMenu } from "../../src/components/StellaActivityMenu";
import { OverlayHost } from "../../src/components/OverlayHost";
import { ChatSettingsPanel } from "../../src/components/ChatSettingsPanel";
import {
  AppBackdrop,
  TOP_BAR_BAR_HEIGHT,
} from "../../src/components/AppBackdrop";
import {
  SIDEBAR_BRAND_CENTER,
  SidebarPanel,
} from "../../src/components/sidebar/SidebarPanel";
import {
  DRAWER_CHEVRON_SIZE,
  DrawerStage,
} from "../../src/components/sidebar/DrawerStage";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import {
  closeDrawer,
  drawerJustOpened,
  drawerProgress,
  isDrawerOpen,
  openDrawer,
  useDrawerLive,
  useDrawerMetrics,
  useDrawerSide,
} from "../../src/lib/drawer";
import { type Colors } from "../../src/theme/colors";
import { useColors, useTheme } from "../../src/theme/theme-context";
import { fonts } from "../../src/theme/fonts";
import { fadeHex } from "../../src/theme/oklch";
import { useChatSearch } from "../../src/lib/chat-search";
import { tapLight } from "../../src/lib/haptics";
import {
  MAIN_TAB_HREFS,
  queueMainTab,
  readMainTabFromPath,
  saveLastMainTab,
  takePendingMainTab,
  type MainTabId,
} from "../../src/lib/last-main-tab";
import {
  subscribeSidebarOpenRequests,
  useBackOverride,
  useTopBarAccessory,
} from "../../src/lib/main-shell-store";
import { useT } from "../../src/i18n";

export const unstable_settings = { anchor: "chat" };

const SIDEBAR_WIDTH = 320;
const TOP_BAR_BUTTON = DRAWER_CHEVRON_SIZE;
const TOP_BAR_INSET = 10;
const TITLE_MAX_FONT_SCALE = 1.3;

const EMPTY_RUNNING_AGENTS: readonly ActivityIndicatorEntry[] = [];

const PAGE_TITLE_KEYS: Partial<Record<MainTabId, string>> = {
  schedule: "mobile.activityHub.tabs.schedule",
  email: "shell.emailDigest.title",
  apps: "mobile.nav.apps",
  files: "mobile.activityHub.tabs.files",
};

export default function MainLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const pathname = usePathname();
  const router = useRouter();
  const drawerLive = useDrawerLive();
  const drawerSide = useDrawerSide();
  const { travel, endTravel } = useDrawerMetrics();
  const [activityMenuRunning, setActivityMenuRunning] = useState<
    readonly ActivityIndicatorEntry[] | null
  >(null);
  const [consentVisible, setConsentVisible] = useState(false);
  const colors = useColors();
  const t = useT();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const session = authClient.useSession();
  useReportTimeZone(Boolean(session.data?.user));

  useEffect(() => {
    if (!hasAiConsent()) {
      setConsentVisible(true);
    }
    return subscribeAiConsentRequested(() => {
      if (!hasAiConsent()) setConsentVisible(true);
    });
  }, []);

  const onConsentAccept = useCallback(() => {
    void grantAiConsent().then(() => setConsentVisible(false));
  }, []);

  const onConsentDecline = useCallback(() => {
    setConsentVisible(false);
    void (async () => {
      try {
        await tearDownPushNotifications();
        await authClient.signOut();
      } catch {
        /* ignore — the local session is gone either way */
      }
      router.replace("/login");
    })();
  }, [router]);

  const activeTab = readMainTabFromPath(pathname);
  const onChatSurface = pathname === "/chat";
  const onTabRoot = Object.values(MAIN_TAB_HREFS).some(
    (href) => href === pathname,
  );
  const backOverride = useBackOverride();
  const pageTitleKey =
    onTabRoot && !backOverride && activeTab
      ? PAGE_TITLE_KEYS[activeTab]
      : undefined;
  const pageTitle = pageTitleKey ? t(pageTitleKey) : null;
  const topBarAccessory = useTopBarAccessory();
  const accessoryVisible = Boolean(pageTitle) && topBarAccessory != null;

  const search = useChatSearch();
  const { close: closeSearch } = search;
  useEffect(() => {
    closeSearch();
  }, [pathname, closeSearch]);

  useEffect(() => {
    if (activeTab) {
      void saveLastMainTab(activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!onChatSurface) return;
    const pending = takePendingMainTab();
    if (pending) router.push(MAIN_TAB_HREFS[pending]);
  }, [onChatSurface, router]);

  const drawerAvailable = onChatSurface || (onTabRoot && !backOverride);
  const backVisible = !drawerAvailable;

  const openSidebar = () => openDrawer("start");

  const selectTab = (tab: MainTabId) => {
    if (!wide && drawerJustOpened()) return;
    const destination = MAIN_TAB_HREFS[tab];
    tapLight();
    if (!wide) closeDrawer();
    if (destination === pathname) return;
    Keyboard.dismiss();
    if (destination === "/chat") {
      router.dismissTo("/chat");
    } else if (onChatSurface) {
      router.push(destination);
    } else if (onTabRoot) {
      router.replace(destination);
    } else if (activeTab === tab) {
      router.dismissTo(destination);
    } else {
      queueMainTab(tab);
      router.dismissTo("/chat");
    }
  };

  const onPressTopLeft = () => {
    if (drawerAvailable) {
      openSidebar();
      return;
    }
    tapLight();
    if (backOverride) {
      backOverride.onPress();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/chat");
  };

  useEffect(() => {
    if (wide && isDrawerOpen()) closeDrawer();
  }, [wide]);

  useEffect(() => {
    if (!drawerAvailable && isDrawerOpen("start")) closeDrawer();
  }, [drawerAvailable]);

  useEffect(() => {
    if (!onChatSurface && isDrawerOpen("end")) closeDrawer();
  }, [onChatSurface]);

  const openSidebarRef = useRef(openSidebar);
  openSidebarRef.current = openSidebar;
  useEffect(
    () =>
      subscribeSidebarOpenRequests(() => {
        if (!wide) openSidebarRef.current();
      }),
    [wide],
  );

  const startHandedOff =
    drawerAvailable && drawerLive && drawerSide === "start";
  const endHandedOff = onChatSurface && drawerLive && drawerSide === "end";

  const topBarFade = useAnimatedStyle(() => ({
    opacity: interpolate(
      drawerProgress.value,
      [0, 0.22],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const topBarHeight = insets.top + TOP_BAR_BAR_HEIGHT;

  return (
    <SafeAreaView style={styles.shell} edges={[]}>
      <StatusBar style={isDark ? "light" : "dark"} />

      {wide ? (
        <>
          <AppBackdrop />
          <View style={styles.wideLayout}>
            <SidebarPanel
              width={SIDEBAR_WIDTH}
              activeTab={activeTab}
              onSelectTab={selectTab}
            />
            <View style={styles.content}>
              <View style={styles.contentSlot}>
                <MainStack />
              </View>
              <View
                pointerEvents="box-none"
                style={[styles.topBar, { height: topBarHeight }]}
              >
                {pageTitle ? (
                  <View pointerEvents="none" style={styles.titleLane}>
                    <Text
                      accessibilityRole="header"
                      style={styles.pageTitle}
                      numberOfLines={1}
                      maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
                    >
                      {pageTitle}
                    </Text>
                  </View>
                ) : null}
                {backVisible ? (
                  <View style={styles.topBarSide}>
                    <GlassIconButton
                      icon="chevron-left"
                      size={TOP_BAR_BUTTON}
                      iconSize={20}
                      accessibilityLabel={
                        backOverride?.label ?? t("mobile.common.back")
                      }
                      onPress={onPressTopLeft}
                    />
                  </View>
                ) : null}
                {accessoryVisible ? (
                  <View style={[styles.topBarSide, styles.topBarEnd]}>
                    {topBarAccessory}
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </>
      ) : (
        <DrawerStage
          enabled={drawerAvailable}
          panel={
            <SidebarPanel
              width={travel}
              animated
              activeTab={activeTab}
              onSelectTab={selectTab}
            />
          }
          end={{
            enabled: onChatSurface,
            panel: <ChatSettingsPanel width={endTravel} />,
            chevron: {
              left: width - TOP_BAR_INSET - TOP_BAR_BUTTON,
              top: topBarHeight - TOP_BAR_BUTTON,
              openCenterY: insets.top + SIDEBAR_BRAND_CENTER,
              openLabel: t("mobile.nav.chatSettingsLabel"),
              closeLabel: t("mobile.nav.backToChat"),
              restIcon: "settings",
            },
          }}
          chevron={{
            left: TOP_BAR_INSET,
            top: topBarHeight - TOP_BAR_BUTTON,
            openCenterY: insets.top + SIDEBAR_BRAND_CENTER,
            openLabel: t("mobile.nav.openLabel"),
            closeLabel:
              activeTab === "chat"
                ? t("mobile.nav.backToChat")
                : t("mobile.nav.closeLabel"),
          }}
        >
          <AppBackdrop />
          <View style={styles.content}>
            <MainStack />
          </View>

          {/* The top bar floats over the routes: the chat runs edge to
              edge underneath it, and every other route starts below it
              (`useShellTopInset`). Taps between its controls pass through
              to the page. */}
          <Animated.View
            pointerEvents="box-none"
            style={[styles.topBar, { height: topBarHeight }, topBarFade]}
          >
            {search.isOpen ? (
              <View style={styles.searchRow}>
                <View style={styles.searchField}>
                  <Icon name="search" size={16} color={colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    value={search.query}
                    onChangeText={search.setQuery}
                    placeholder={t("mobile.search.placeholder")}
                    placeholderTextColor={fadeHex(colors.textMuted, 0.6)}
                    selectionColor={colors.accent}
                    autoFocus
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {search.query.length > 0 ? (
                    <Pressable
                      onPress={() => search.setQuery("")}
                      hitSlop={8}
                      accessibilityLabel={t("mobile.search.clearLabel")}
                    >
                      <Icon name="x" size={15} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  onPress={search.close}
                  hitSlop={8}
                  accessibilityLabel={t("mobile.search.cancelLabel")}
                  style={styles.searchCancel}
                >
                  <Text style={styles.searchCancelText}>
                    {t("mobile.common.cancel")}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {!search.isOpen && pageTitle ? (
              <View pointerEvents="none" style={styles.titleLane}>
                <Text
                  accessibilityRole="header"
                  style={styles.pageTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={TITLE_MAX_FONT_SCALE}
                >
                  {pageTitle}
                </Text>
              </View>
            ) : null}
            {!search.isOpen && onChatSurface ? (
              <View pointerEvents="box-none" style={styles.statusLane}>
                <StellaStatusHeader onPress={setActivityMenuRunning} />
              </View>
            ) : null}
            {search.isOpen ? null : (
              <View
                style={[styles.topBarSide, startHandedOff && styles.handedOff]}
                pointerEvents={startHandedOff ? "none" : "auto"}
                accessibilityElementsHidden={startHandedOff}
              >
                <GlassIconButton
                  icon={drawerAvailable ? "chevron-right" : "chevron-left"}
                  size={TOP_BAR_BUTTON}
                  iconSize={20}
                  accessibilityLabel={
                    drawerAvailable
                      ? t("mobile.nav.openLabel")
                      : (backOverride?.label ?? t("mobile.common.back"))
                  }
                  onPress={onPressTopLeft}
                />
              </View>
            )}
            {!search.isOpen && accessoryVisible ? (
              <View style={[styles.topBarSide, styles.topBarEnd]}>
                {topBarAccessory}
              </View>
            ) : null}
            {!search.isOpen && onChatSurface ? (
              <View
                style={[
                  styles.topBarSide,
                  styles.topBarEnd,
                  endHandedOff && styles.handedOff,
                ]}
                pointerEvents={endHandedOff ? "none" : "auto"}
                accessibilityElementsHidden={endHandedOff}
              >
                <GlassIconButton
                  icon="settings"
                  size={TOP_BAR_BUTTON}
                  iconSize={19}
                  accessibilityLabel={t("mobile.nav.chatSettingsLabel")}
                  onPress={() => openDrawer("end")}
                />
              </View>
            ) : null}
          </Animated.View>
          <OverlayHost />
        </DrawerStage>
      )}
      <StellaActivityMenu
        visible={activityMenuRunning !== null}
        running={activityMenuRunning ?? EMPTY_RUNNING_AGENTS}
        onClose={() => setActivityMenuRunning(null)}
      />
      <AiConsentModal
        visible={consentVisible}
        onAccept={onConsentAccept}
        onDecline={onConsentDecline}
      />
    </SafeAreaView>
  );
}

function MainStack() {
  const pathname = usePathname();
  return (
    <NavigationThemeProvider value={TRANSPARENT_NAVIGATION_THEME}>
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
            animation: "slide_from_right",
            gestureEnabled: false,
          }}
        >
          {/* Tabs switch instantly; pages pushed from a tab (Cloud Home)
              keep the slide. */}
          <Stack.Screen name="schedule" options={TAB_SCREEN_OPTIONS} />
          <Stack.Screen name="email" options={TAB_SCREEN_OPTIONS} />
          <Stack.Screen name="apps" options={TAB_SCREEN_OPTIONS} />
          <Stack.Screen name="files" options={TAB_SCREEN_OPTIONS} />
          <Stack.Screen name="settings" options={TAB_SCREEN_OPTIONS} />
        </Stack>
        <PersistentAppsHost visible={pathname === "/apps"} />
      </View>
    </NavigationThemeProvider>
  );
}

const TAB_SCREEN_OPTIONS = { animation: "none" } as const;

const TRANSPARENT_NAVIGATION_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "transparent" },
};

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    shell: {
      flex: 1,
      backgroundColor: colors.background,
    },

    wideLayout: {
      flex: 1,
      flexDirection: "row",
    },

    topBar: {
      alignItems: "flex-end",
      flexDirection: "row",
      left: 0,
      paddingHorizontal: TOP_BAR_INSET,
      position: "absolute",
      right: 0,
      top: 0,
      overflow: "visible",
      zIndex: 1,
    },
    statusLane: {
      bottom: 0,
      height: TOP_BAR_BUTTON,
      left: 0,
      position: "absolute",
      right: 0,
    },
    titleLane: {
      alignItems: "center",
      bottom: 0,
      height: TOP_BAR_BUTTON,
      justifyContent: "center",
      left: TOP_BAR_INSET + TOP_BAR_BUTTON + 8,
      position: "absolute",
      right: TOP_BAR_INSET + TOP_BAR_BUTTON + 8,
    },
    pageTitle: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 20,
      letterSpacing: -0.6,
    },
    topBarEnd: { marginLeft: "auto" },
    topBarSide: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      width: 44,
    },
    searchRow: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 8,
      height: 44,
      paddingLeft: 8,
    },
    searchField: {
      alignItems: "center",
      backgroundColor: colors.muted,
      borderColor: colors.border,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      flexDirection: "row",
      gap: 8,
      height: 36,
      paddingHorizontal: 10,
    },
    searchInput: {
      color: colors.text,
      flex: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 16,
      padding: 0,
    },
    searchCancel: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      paddingHorizontal: 4,
    },
    searchCancelText: {
      color: colors.accent,
      fontFamily: fonts.sans.medium,
      fontSize: 15,
    },
    contentSlot: {
      flex: 1,
      minHeight: 0,
    },
    handedOff: { opacity: 0 },

    content: {
      flex: 1,
      minHeight: 0,
    },
  } as const);
