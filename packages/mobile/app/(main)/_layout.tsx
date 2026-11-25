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
import { warmRememberedViews } from "../../src/lib/backend";
import { tearDownPushNotifications } from "../../src/lib/notifications";
import { useReportTimeZone } from "../../src/lib/schedule-zone";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { BottomBar } from "../../src/components/BottomBar";
import { Icon } from "../../src/components/Icon";
import { GlassIconButton } from "../../src/components/GlassIconButton";
import { StellaStatusHeader } from "../../src/components/StellaStatusHeader";
import { StellaActivityMenu } from "../../src/components/StellaActivityMenu";
import { OverlayHost } from "../../src/components/OverlayHost";
import { AccountPanel } from "../../src/components/AccountPanel";
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
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Text } from "../../src/components/Text";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import {
  closeDrawer,
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
  readMainTabFromPath,
  saveLastMainTab,
  takePendingMainTab,
  type MainTabId,
} from "../../src/lib/last-main-tab";
import {
  useBackOverride,
  useTopBarAccessory,
} from "../../src/lib/main-shell-store";
import {
  bottomBarTabFor,
  isBottomBarTab,
  useWideLayout,
  type BottomBarTab,
} from "../../src/lib/bottom-bar";
import { useT } from "../../src/i18n";
import { topBarCover, useTopBarCovered } from "../../src/lib/top-bar-cover";

export const unstable_settings = { anchor: "(tabs)" };

const SIDEBAR_WIDTH = 320;
const TOP_BAR_BUTTON = DRAWER_CHEVRON_SIZE;
const TOP_BAR_INSET = 10;
const ACCOUNT_ICON_SIZE = 18;
const SETTINGS_ICON_SIZE = 19;
const TITLE_MAX_FONT_SCALE = 1.3;

const EMPTY_RUNNING_AGENTS: readonly ActivityIndicatorEntry[] = [];

const PAGE_TITLE_KEYS: Partial<Record<MainTabId, string>> = {
  schedule: "mobile.activityHub.tabs.schedule",
  email: "email.title",
  apps: "mobile.nav.apps",
  files: "mobile.activityHub.tabs.files",
};

export default function MainLayout() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = useWideLayout();
  const pathname = usePathname();
  const router = useRouter();
  const drawerLive = useDrawerLive();
  const drawerSide = useDrawerSide();
  const { travel } = useDrawerMetrics();
  const [activityMenuRunning, setActivityMenuRunning] = useState<
    readonly ActivityIndicatorEntry[] | null
  >(null);
  const [consentVisible, setConsentVisible] = useState(false);
  const colors = useColors();
  const t = useT();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const session = authClient.useSession();
  const ownerId = session.data?.user.id;
  useReportTimeZone(Boolean(ownerId));
  useEffect(() => {
    if (ownerId) void warmRememberedViews(ownerId);
  }, [ownerId]);

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
      } catch {}
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
  const pageTitle = pageTitleKey
    ? t(pageTitleKey)
    : (backOverride?.title ?? null);
  const topBarAccessory = useTopBarAccessory();
  const accessoryVisible = Boolean(pageTitle) && topBarAccessory != null;

  const search = useChatSearch();
  const { close: closeSearch } = search;
  useEffect(() => {
    closeSearch();
  }, [pathname, closeSearch]);

  useEffect(() => {
    if (activeTab && (wide || isBottomBarTab(activeTab))) {
      void saveLastMainTab(activeTab);
    }
  }, [activeTab, wide]);

  const onPlace = onChatSurface || (onTabRoot && !backOverride);
  const barTab = bottomBarTabFor(activeTab);
  const onBarPlace = onPlace && isBottomBarTab(activeTab);
  const backVisible = wide ? !onPlace : !onBarPlace;

  const barTabPaths = useRef<Partial<Record<BottomBarTab, string>>>({});
  useEffect(() => {
    if (barTab && onTabRoot) barTabPaths.current[barTab] = pathname;
  }, [barTab, onTabRoot, pathname]);

  const showTab = useCallback(
    (tab: MainTabId, from: MainTabId | null) => {
      const destination = MAIN_TAB_HREFS[tab];
      if (tab === "settings") {
        if (from === "settings") router.dismissTo(destination);
        else router.push(destination);
        return;
      }
      const resumed =
        !wide && isBottomBarTab(tab) && bottomBarTabFor(from) !== tab
          ? barTabPaths.current[tab]
          : undefined;
      router.dismissTo(resumed ?? destination, { withAnchor: true });
    },
    [router, wide],
  );

  useEffect(() => {
    if (!onChatSurface) return;
    const pending = takePendingMainTab();
    if (!pending) return;
    if (pending === "settings" && !wide) openDrawer("start");
    else showTab(pending, "chat");
  }, [onChatSurface, showTab, wide]);

  const selectTab = (tab: MainTabId) => {
    tapLight();
    if (MAIN_TAB_HREFS[tab] === pathname) {
      if (backOverride) (backOverride.onReset ?? backOverride.onPress)();
      return;
    }
    Keyboard.dismiss();
    showTab(tab, activeTab);
  };

  const onPressTopLeft = () => {
    if (!backVisible) {
      openDrawer("start");
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
    if (!onChatSurface && isDrawerOpen("end")) closeDrawer();
  }, [onChatSurface]);

  useEffect(() => {
    if (!onBarPlace && isDrawerOpen("start")) closeDrawer();
  }, [onBarPlace]);

  useEffect(
    () => () => {
      if (isDrawerOpen()) closeDrawer();
    },
    [],
  );

  const accountHandedOff = onBarPlace && drawerLive && drawerSide === "start";
  const settingsHandedOff =
    onChatSurface && drawerLive && drawerSide === "end";

  const topBarFade = useAnimatedStyle(() => ({
    opacity:
      interpolate(drawerProgress.value, [0, 0.22], [1, 0], Extrapolation.CLAMP) *
      (1 - topBarCover.value),
  }));
  const topBarCovered = useTopBarCovered();

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
                  <View style={[styles.topBarAccessory, styles.topBarEnd]}>
                    {topBarAccessory}
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </>
      ) : (
        <DrawerStage
          start={{
            enabled: onBarPlace,
            panel: <AccountPanel width={travel} />,
            chevron: {
              left: TOP_BAR_INSET,
              top: topBarHeight - TOP_BAR_BUTTON,
              openCenterY: insets.top + SIDEBAR_BRAND_CENTER,
              openLabel: t("mobile.nav.account"),
              closeLabel: t("mobile.common.back"),
              icon: "chevron-left",
              restIcon: "user",
              restIconSize: ACCOUNT_ICON_SIZE,
            },
          }}
          end={{
            enabled: onChatSurface,
            panel: <ChatSettingsPanel width={travel} />,
            chevron: {
              left: width - TOP_BAR_INSET - TOP_BAR_BUTTON,
              top: topBarHeight - TOP_BAR_BUTTON,
              openCenterY: insets.top + SIDEBAR_BRAND_CENTER,
              openLabel: t("mobile.nav.chatSettingsLabel"),
              closeLabel: t("mobile.nav.backToChat"),
              icon: "chevron-right",
              restIcon: "settings",
              restIconSize: SETTINGS_ICON_SIZE,
            },
          }}
        >
          <AppBackdrop />
          <View style={styles.content}>
            <MainStack />
          </View>
          <BottomBar active={barTab} onSelect={selectTab} />

          <Animated.View
            pointerEvents={topBarCovered ? "none" : "box-none"}
            accessibilityElementsHidden={topBarCovered}
            importantForAccessibility={
              topBarCovered ? "no-hide-descendants" : "auto"
            }
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
                style={[
                  styles.topBarSide,
                  accountHandedOff && styles.handedOff,
                ]}
                pointerEvents={accountHandedOff ? "none" : "auto"}
                accessibilityElementsHidden={accountHandedOff}
              >
                <GlassIconButton
                  icon={backVisible ? "chevron-left" : "user"}
                  size={TOP_BAR_BUTTON}
                  iconSize={backVisible ? 20 : ACCOUNT_ICON_SIZE}
                  accessibilityLabel={
                    backVisible
                      ? (backOverride?.label ?? t("mobile.common.back"))
                      : t("mobile.nav.account")
                  }
                  onPress={onPressTopLeft}
                />
              </View>
            )}
            {!search.isOpen && accessoryVisible ? (
              <View style={[styles.topBarAccessory, styles.topBarEnd]}>
                {topBarAccessory}
              </View>
            ) : null}
            {!search.isOpen && onChatSurface ? (
              <View
                style={[
                  styles.topBarSide,
                  styles.topBarEnd,
                  settingsHandedOff && styles.handedOff,
                ]}
                pointerEvents={settingsHandedOff ? "none" : "auto"}
                accessibilityElementsHidden={settingsHandedOff}
              >
                <GlassIconButton
                  icon="settings"
                  size={TOP_BAR_BUTTON}
                  iconSize={SETTINGS_ICON_SIZE}
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
          <Stack.Screen name="(tabs)" options={TAB_SCREEN_OPTIONS} />
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
    topBarAccessory: {
      height: TOP_BAR_BUTTON,
      justifyContent: "center",
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
