import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  BackHandler,
  Linking,
  Pressable,
  type ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  Extrapolation,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
} from "react-native-reanimated";
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { resolveThemeColors } from "@stella/theme";
import { USER_ASK_URGENCY_NAMES } from "@stella/contracts/user-ask";
import { GlassToggle } from "./glass";
import { Icon } from "./Icon";
import {
  SubscriptionSection,
  SubscriptionSummaryCard,
} from "./SubscriptionSection";
import { FeedbackSheet } from "./FeedbackSheet";
import { Dot, Hairline, SectionLabel } from "./chat-settings/kit";
import { AppearanceSubView } from "./settings/AppearanceSubView";
import { SettingsScroll } from "./settings/SettingsScroll";
import { PanelPageHeader } from "./sidebar/PanelPageHeader";
import { SIDEBAR_BRAND_ROW } from "./sidebar/SidebarPanel";
import { drawerProgress } from "../lib/drawer";
import { UserAskEscalationSection } from "./settings/UserAskEscalationSection";
import { SavedLoginsSection } from "./settings/SavedLoginsSection";
import { ServerSection } from "./settings/ServerSection";
import {
  makeSettingsStyles,
  type SettingsStyles,
} from "./settings/settings-styles";
import { env } from "../config/env";
import { authClient } from "../lib/auth-client";
import {
  requestAccountDeletion,
  type AccountDeletionOutcome,
} from "../lib/account-deletion";
import { clearAiConsent } from "../lib/ai-consent";
import { clearCachedToken } from "../lib/auth-token";
import { clearAccountChatData } from "../lib/chat-account-cleanup";
import { useCloudBrowserActions } from "../lib/cloud-browser";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { tapLight } from "../lib/haptics";
import { publishBackOverride } from "../lib/main-shell-store";
import { selfHostServersAvailable } from "../lib/native-capabilities";
import { tearDownPushNotifications } from "../lib/notifications";
import {
  getNotificationsMuted,
  setNotificationsMuted,
  subscribeNotificationsMuted,
} from "../lib/notifications-prefs";
import {
  clearStoredPhoneAccess,
  listStoredPairedPhoneAccess,
  type StoredPhoneAccess,
} from "../lib/phone-access";
import { withdrawSavedValuesDevice } from "../lib/saved-values";
import {
  savedValuesNeedsAnswer,
  useSavedValuesTrust,
} from "../lib/saved-values-trust";
import { useServerFeatures } from "../lib/server-features";
import { isSelfHostedLaunch, launchServer } from "../lib/server-registry";
import { useUserAskEscalationPolicy } from "../lib/user-ask-policy";
import { userFacingError } from "../lib/user-facing-error";
import {
  getVoiceEnabled,
  setVoiceEnabled,
  subscribeVoiceEnabled,
} from "../lib/voice-visibility";
import { type Colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { useColors, useTheme } from "../theme/theme-context";
import { useT } from "../i18n";

type AccountSubpage =
  | "subscription"
  | "appearance"
  | "notifications"
  | "saved-logins"
  | "server";

export type SettingsContentProps = {
  active?: boolean;
  inDrawer?: boolean;
  onOpenCloudHome?: () => void;
};

function StartRise({
  i,
  animated,
  children,
}: {
  i: number;
  animated: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const style = useAnimatedStyle(() => {
    if (!animated) return { opacity: 1, transform: [{ translateX: 0 }] };
    const v = Math.min(drawerProgress.value, 1);
    const from = Math.min(0.08 * i, 0.5);
    return {
      opacity: interpolate(v, [from, from + 0.5], [0, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateX: reduce
            ? 0
            : interpolate(v, [0, 1], [-14 - i * 7, 0], Extrapolation.CLAMP),
        },
      ],
    };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

function initialFor(name: string, email: string): string {
  const source = (name || email).trim();
  const match = source.match(/[A-Za-z0-9]/u);
  return match ? match[0].toUpperCase() : "S";
}

export function SettingsContent({
  active = true,
  inDrawer = false,
  onOpenCloudHome,
}: SettingsContentProps = {}) {
  const colors = useColors();
  const t = useT();
  const { preference, selectedThemeId, themes, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settingsStyles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const session = authClient.useSession();
  const features = useServerFeatures();
  const savedLoginsTrust = useSavedValuesTrust();
  const [subpage, setSubpage] = useState<AccountSubpage | null>(null);
  const [moved, setMoved] = useState(false);
  const [isResettingCloudBrowser, setIsResettingCloudBrowser] = useState(false);
  const { resetProfile: resetCloudBrowserProfile } = useCloudBrowserActions();
  const [notificationsMuted, setMutedLocal] = useState(() =>
    getNotificationsMuted(),
  );
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => subscribeNotificationsMuted(setMutedLocal), []);
  const [voiceEnabled, setVoiceEnabledLocal] = useState(() =>
    getVoiceEnabled(),
  );
  useEffect(() => subscribeVoiceEnabled(setVoiceEnabledLocal), []);

  const user = session.data?.user;
  const email =
    launchServer.kind === "self-hosted"
      ? t("mobile.selfHost.ownerOf", { name: launchServer.name })
      : (user?.email ?? "");
  const userName = user?.name?.trim() ?? "";

  const isSignedIn = Boolean(user);
  const showFeedback = isSignedIn && !isSelfHostedLaunch;
  const showLoadingHeader = session.isPending && !user;
  const escalation = useUserAskEscalationPolicy(isSignedIn, active);

  useEffect(() => {
    if (!active) {
      setMoved(false);
      setSubpage(null);
    }
  }, [active]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [subpage]);

  useEffect(() => {
    if (inDrawer || subpage === null) return;
    publishBackOverride({
      label: t("mobile.nav.account"),
      onPress: () => {
        setMoved(true);
        setSubpage(null);
      },
    });
    return () => {
      publishBackOverride(null);
    };
  }, [inDrawer, subpage, t]);

  useEffect(() => {
    if (subpage === null) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setMoved(true);
      setSubpage(null);
      return true;
    });
    return () => sub.remove();
  }, [subpage]);

  const openSubpage = (next: AccountSubpage) => {
    tapLight();
    setMoved(true);
    setSubpage(next);
  };

  const closeSubpage = () => {
    tapLight();
    setMoved(true);
    setSubpage(null);
  };

  const runResetCloudBrowser = async () => {
    if (isResettingCloudBrowser) return;
    setIsResettingCloudBrowser(true);
    try {
      await resetCloudBrowserProfile();
      Alert.alert(
        t("cloudBrowser.settings.title"),
        t("cloudBrowser.settings.resetComplete"),
      );
    } catch {
      Alert.alert(
        t("cloudBrowser.settings.title"),
        t("cloudBrowser.settings.resetFailed"),
      );
    } finally {
      setIsResettingCloudBrowser(false);
    }
  };

  const confirmResetCloudBrowser = () => {
    Alert.alert(
      t("cloudBrowser.settings.confirmTitle"),
      t("cloudBrowser.settings.confirmBody"),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("cloudBrowser.settings.reset"),
          style: "destructive",
          onPress: () => void runResetCloudBrowser(),
        },
      ],
    );
  };

  const toggleNotifications = (next: boolean) => {
    setMutedLocal(!next);
    void setNotificationsMuted(!next);
  };

  const clearLocalAccountState = async () => {
    const paired = await listStoredPairedPhoneAccess().catch(
      () => [] as StoredPhoneAccess[],
    );
    await Promise.all(
      paired.map((access) =>
        clearStoredPhoneAccess(access.desktopDeviceId).catch(() => {}),
      ),
    );
    await clearAccountChatData();
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      await tearDownPushNotifications();
      await withdrawSavedValuesDevice();
      await authClient.signOut();
      clearCachedToken();
      await clearLocalAccountState();
    } catch (e) {
      Alert.alert(t("mobile.settings.signOutLabel"), userFacingError(e));
    } finally {
      setIsSigningOut(false);
    }
  };

  const runDeleteAccount = async () => {
    setIsDeletingAccount(true);
    let outcome: AccountDeletionOutcome;
    try {
      outcome = await requestAccountDeletion();
    } catch (e) {
      outcome = { ok: false, message: userFacingError(e) };
    }
    if (!outcome.ok) {
      setIsDeletingAccount(false);
      Alert.alert(
        t("mobile.settings.deleteFailedTitle"),
        `${t("mobile.settings.deleteFailedBody")}\n\n${outcome.message}`,
        [
          { text: t("mobile.common.cancel"), style: "cancel" },
          {
            text: t("mobile.settings.deleteRetry"),
            style: "destructive",
            onPress: () => void runDeleteAccount(),
          },
        ],
      );
      return;
    }
    await tearDownPushNotifications().catch(() => {});
    await withdrawSavedValuesDevice();
    clearCachedToken();
    await authClient.signOut().catch(() => {});
    await clearLocalAccountState().catch(() => {});
    clearAiConsent();
    setIsDeletingAccount(false);
    Alert.alert(
      outcome.scheduled
        ? t("mobile.settings.deletionScheduledTitle")
        : t("mobile.settings.deleteConfirmTitle"),
      outcome.scheduled
        ? t("settings.account.toasts.deletionScheduled")
        : t("settings.account.toasts.accountDeleted"),
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      t("mobile.settings.deleteConfirmTitle"),
      t("mobile.settings.deleteConfirmBody"),
      [
        { text: t("mobile.common.cancel"), style: "cancel" },
        {
          text: t("mobile.common.delete"),
          style: "destructive",
          onPress: () => void runDeleteAccount(),
        },
      ],
    );
  };

  const activeTheme =
    themes.find((item) => item.id === selectedThemeId) ?? themes[0];
  const activeThemePreview = activeTheme
    ? resolveThemeColors(activeTheme, isDark).colors
    : null;

  const appearanceValue = t(`mobile.settings.appearance.${preference}`);
  const notificationsValue =
    isSignedIn && escalation.available
      ? t(
          `mobile.settings.userAsk.level.${USER_ASK_URGENCY_NAMES[escalation.policy.ceiling - 1]}`,
        )
      : undefined;

  const showSavedLogins = isSignedIn && savedLoginsTrust.standing !== "off";
  const savedLoginsAttention = savedValuesNeedsAnswer(savedLoginsTrust);
  const savedLoginsValue =
    savedLoginsTrust.standing === "member"
      ? String(savedLoginsTrust.devices.length)
      : undefined;

  const activeServerName =
    launchServer.kind === "hosted"
      ? t("mobile.selfHost.hostedName")
      : launchServer.name;

  const showNotificationsRow = features.push || isSignedIn;
  const showCloudSection = isSignedIn || selfHostServersAvailable;

  if (subpage !== null) {
    const subpageTitle =
      subpage === "subscription"
        ? t("billing.mobile.sectionTitle")
        : subpage === "appearance"
          ? t("mobile.settings.appearanceSection")
          : subpage === "notifications"
            ? t("mobile.settings.notificationsSection")
            : subpage === "saved-logins"
              ? t("mobile.savedLogins.section")
              : t("mobile.selfHost.serverSection");

    return (
      <Animated.View
        key={`sub:${subpage}`}
        style={styles.page}
        entering={FadeInRight.duration(240)}
        exiting={FadeOut.duration(120)}
      >
        <SettingsScroll ref={scrollRef} inDrawer={inDrawer}>
          {inDrawer ? (
            <View testID={`account-subpage-${subpage}`}>
              <PanelPageHeader
                back={t("mobile.nav.account")}
                onBack={closeSubpage}
                title={subpageTitle}
              />
            </View>
          ) : (
            <View
              style={styles.pageSubHeader}
              testID={`account-subpage-${subpage}`}
            >
              <Text style={styles.pageSubTitle} accessibilityRole="header">
                {subpageTitle}
              </Text>
            </View>
          )}

          {subpage === "subscription" ? <SubscriptionSection embedded /> : null}

          {subpage === "appearance" ? (
            <AppearanceSubView styles={settingsStyles} />
          ) : null}

          {subpage === "notifications" ? (
            <>
              {features.push ? (
                <View style={settingsStyles.row}>
                  <View style={settingsStyles.rowCopy}>
                    <Text style={settingsStyles.rowLabel}>
                      {t("mobile.settings.pushToggleLabel")}
                    </Text>
                    <Text style={settingsStyles.rowSub}>
                      {t("mobile.settings.pushToggleSub")}
                    </Text>
                  </View>
                  <GlassToggle
                    value={!notificationsMuted}
                    onValueChange={toggleNotifications}
                    accessibilityLabel={t("mobile.settings.pushToggleA11y")}
                  />
                </View>
              ) : null}
              <UserAskEscalationSection
                enabled={isSignedIn}
                active={active}
                styles={settingsStyles}
                embedded
                view={escalation}
              />
            </>
          ) : null}

          {subpage === "saved-logins" ? (
            <SavedLoginsSection styles={settingsStyles} embedded />
          ) : null}

          {subpage === "server" ? (
            <ServerSection styles={settingsStyles} colors={colors} embedded />
          ) : null}
        </SettingsScroll>
      </Animated.View>
    );
  }

  let riseIndex = 0;

  return (
    <Animated.View
      key="account-root"
      style={styles.page}
      entering={moved ? FadeInLeft.duration(240) : undefined}
      exiting={FadeOut.duration(120)}
    >
      <SettingsScroll ref={scrollRef} inDrawer={inDrawer}>
        <StartRise i={riseIndex++} animated={inDrawer}>
          <View style={inDrawer ? styles.drawerTitleRow : styles.titleRow}>
            <Text
              style={styles.title}
              accessibilityRole="header"
              numberOfLines={1}
              maxFontSizeMultiplier={1}
            >
              {t("mobile.nav.account")}
            </Text>
          </View>
        </StartRise>

        <StartRise i={riseIndex++} animated={inDrawer}>
          <View style={styles.firstSection} />
          {isSignedIn ? (
            <View style={styles.identityRow}>
              <View style={styles.monogram}>
                <Text
                  style={styles.monogramText}
                  maxFontSizeMultiplier={1}
                  numberOfLines={1}
                >
                  {initialFor(userName, email)}
                </Text>
              </View>
              <View style={styles.identityCopy}>
                {userName ? (
                  <Text
                    style={styles.identityPrimary}
                    numberOfLines={1}
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                  >
                    {userName}
                  </Text>
                ) : null}
                {email ? (
                  <Text
                    style={
                      userName
                        ? styles.identitySecondary
                        : styles.identityPrimary
                    }
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    selectable
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                  >
                    {email}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : showLoadingHeader ? (
            <Text style={settingsStyles.hint}>
              {t("mobile.settings.loadingSession")}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.settings.signInTitle")}
              onPress={() => {
                tapLight();
                router.replace("/login");
              }}
              style={({ pressed }) => [
                styles.identityRow,
                pressed && settingsStyles.rowPressed,
              ]}
            >
              <View style={styles.monogram}>
                <Icon name="user" size={18} color={colors.accent} />
              </View>
              <Text style={[styles.navLabel, { color: colors.accent }]}>
                {t("mobile.settings.signIn")}
              </Text>
              <Icon
                name="chevron-right"
                size={15}
                color={colors.textMuted}
                weight="semibold"
              />
            </Pressable>
          )}
        </StartRise>

        {isSignedIn && features.billing ? (
          <StartRise i={riseIndex++} animated={inDrawer}>
            <Hairline space={18} />
            <SubscriptionSummaryCard
              onPress={() => openSubpage("subscription")}
            />
          </StartRise>
        ) : null}

        <StartRise i={riseIndex++} animated={inDrawer}>
          <Hairline space={20} />
          <SectionLabel>{t("settings.groups.app")}</SectionLabel>
          <View style={styles.navList}>
            <AiryNavRow
              testID="account-appearance-row"
              label={t("mobile.settings.appearanceSection")}
              trailing={appearanceValue}
              trailingDot={
                activeThemePreview ? (
                  <View
                    style={[
                      styles.swatchDot,
                      { backgroundColor: activeThemePreview.primary },
                    ]}
                  />
                ) : undefined
              }
              accessibilityLabel={`${t("mobile.settings.appearanceSection")}, ${appearanceValue}`}
              styles={styles}
              colors={colors}
              onPress={() => openSubpage("appearance")}
            />

            {showNotificationsRow ? (
              <AiryNavRow
                testID="account-notifications-row"
                label={t("mobile.settings.notificationsSection")}
                trailing={notificationsValue}
                accessibilityLabel={
                  notificationsValue
                    ? `${t("mobile.settings.notificationsSection")}, ${notificationsValue}`
                    : t("mobile.settings.notificationsSection")
                }
                styles={styles}
                colors={colors}
                onPress={() => openSubpage("notifications")}
              />
            ) : null}

            {features.realtimeVoice ? (
              <View style={styles.toggleRow}>
                <View style={settingsStyles.rowCopy}>
                  <Text
                    style={styles.toggleLabel}
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                  >
                    {t("settings.voiceAgent.title")}
                  </Text>
                  <Text
                    style={settingsStyles.rowSub}
                    numberOfLines={2}
                    maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                  >
                    {t("settings.voiceAgent.description")}
                  </Text>
                </View>
                <GlassToggle
                  value={voiceEnabled}
                  onValueChange={(next) => void setVoiceEnabled(next)}
                  accessibilityLabel={t("settings.voiceAgent.title")}
                />
              </View>
            ) : null}
          </View>
        </StartRise>

        {showCloudSection ? (
          <StartRise i={riseIndex++} animated={inDrawer}>
            <Hairline space={20} />
            <SectionLabel>{t("mobile.cloudHome.settingsSection")}</SectionLabel>
            <View style={styles.navList}>
              {isSignedIn ? (
                <AiryNavRow
                  testID="account-memory-row"
                  label={t("settings.memory.title")}
                  accessibilityLabel={t("mobile.cloudHome.openSettingsLabel")}
                  showChevron
                  styles={styles}
                  colors={colors}
                  onPress={() => {
                    tapLight();
                    if (onOpenCloudHome) onOpenCloudHome();
                    else router.push("/cloud-home");
                  }}
                />
              ) : null}

              {showSavedLogins ? (
                <AiryNavRow
                  testID="account-saved-logins-row"
                  label={t("mobile.savedLogins.section")}
                  trailing={savedLoginsValue}
                  attention={savedLoginsAttention}
                  accessibilityLabel={t("mobile.savedLogins.section")}
                  styles={styles}
                  colors={colors}
                  onPress={() => openSubpage("saved-logins")}
                />
              ) : null}

              {selfHostServersAvailable ? (
                <AiryNavRow
                  testID="account-server-row"
                  label={t("mobile.selfHost.serverSection")}
                  trailing={activeServerName}
                  accessibilityLabel={`${t("mobile.selfHost.serverSection")}, ${activeServerName}`}
                  styles={styles}
                  colors={colors}
                  onPress={() => openSubpage("server")}
                />
              ) : null}

              {isSignedIn ? (
                <View style={styles.toggleRow}>
                  <View style={settingsStyles.rowCopy}>
                    <Text
                      style={styles.toggleLabel}
                      numberOfLines={1}
                      maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                    >
                      {t("cloudBrowser.settings.defaultProfile")}
                    </Text>
                    <Text
                      style={settingsStyles.rowSub}
                      numberOfLines={2}
                      maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                    >
                      {t("cloudBrowser.settings.description")}
                    </Text>
                  </View>
                  <Pressable
                    onPress={confirmResetCloudBrowser}
                    disabled={isResettingCloudBrowser}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t("cloudBrowser.settings.reset")}
                    style={({ pressed }) => [
                      (pressed || isResettingCloudBrowser) && styles.dimmed,
                    ]}
                  >
                    <Text style={settingsStyles.rowDanger}>
                      {isResettingCloudBrowser
                        ? t("cloudBrowser.settings.resetting")
                        : t("cloudBrowser.settings.reset")}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </StartRise>
        ) : null}

        <StartRise i={riseIndex++} animated={inDrawer}>
          <Hairline space={20} />
          <SectionLabel>{t("mobile.settings.aboutSection")}</SectionLabel>
          <View style={styles.navList}>
            {showFeedback ? (
              <AiryNavRow
                testID="account-feedback-row"
                label={t("sidebar.feedback")}
                accessibilityLabel={t("sidebar.feedback")}
                subtle
                styles={styles}
                colors={colors}
                onPress={() => {
                  tapLight();
                  setFeedbackOpen(true);
                }}
              />
            ) : null}
            <AiryNavRow
              label={t("mobile.settings.termsOfService")}
              accessibilityLabel={t("mobile.settings.openTermsLabel")}
              subtle
              external
              styles={styles}
              colors={colors}
              onPress={() => void Linking.openURL(`${env.siteUrl}/terms`)}
            />
            <AiryNavRow
              label={t("mobile.settings.privacyPolicy")}
              accessibilityLabel={t("mobile.settings.openPrivacyLabel")}
              subtle
              external
              styles={styles}
              colors={colors}
              onPress={() => void Linking.openURL(`${env.siteUrl}/privacy`)}
            />
          </View>
        </StartRise>

        {isSignedIn ? (
          <StartRise i={riseIndex++} animated={inDrawer}>
            <Hairline space={20} />
            <View style={styles.footerActions}>
              <Pressable
                onPress={() => void signOut()}
                disabled={isSigningOut || isDeletingAccount}
                accessibilityRole="button"
                accessibilityLabel={t("mobile.settings.signOutLabel")}
                style={({ pressed }) => [
                  styles.footerActionRow,
                  pressed && settingsStyles.rowPressed,
                  (isSigningOut || isDeletingAccount) &&
                    settingsStyles.rowDisabled,
                ]}
              >
                <Text style={styles.signOutText}>
                  {isSigningOut
                    ? t("mobile.settings.signingOut")
                    : t("mobile.settings.signOut")}
                </Text>
              </Pressable>

              {isSelfHostedLaunch ? null : (
                <Pressable
                  onPress={confirmDeleteAccount}
                  disabled={isDeletingAccount || isSigningOut}
                  accessibilityRole="button"
                  accessibilityLabel={t("mobile.settings.deleteAccountLabel")}
                  style={({ pressed }) => [
                    styles.footerActionRow,
                    pressed && styles.dimmed,
                  ]}
                >
                  <Text style={styles.deleteAccountText}>
                    {isDeletingAccount
                      ? t("mobile.settings.deletingAccount")
                      : t("mobile.settings.deleteAccount")}
                  </Text>
                </Pressable>
              )}
            </View>
          </StartRise>
        ) : null}

        <FeedbackSheet
          visible={feedbackOpen}
          onClose={() => setFeedbackOpen(false)}
        />
      </SettingsScroll>
    </Animated.View>
  );
}

function AiryNavRow({
  testID,
  label,
  trailing,
  trailingDot,
  attention = false,
  subtle = false,
  external = false,
  showChevron = false,
  accessibilityLabel,
  styles,
  colors,
  onPress,
}: {
  testID?: string;
  label: string;
  trailing?: string;
  trailingDot?: ReactNode;
  attention?: boolean;
  subtle?: boolean;
  external?: boolean;
  showChevron?: boolean;
  accessibilityLabel: string;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        subtle ? styles.subtleNavRow : styles.navRow,
        pressed && styles.navPressed,
      ]}
    >
      <View style={styles.navLabelLine}>
        <Text
          style={subtle ? styles.subtleNavLabel : styles.navLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {label}
        </Text>
        {attention ? <Dot size={6} /> : null}
      </View>
      {trailing || trailingDot ? (
        <View style={styles.navMetaWrap}>
          {trailingDot}
          {trailing ? (
            <Text
              style={styles.navMeta}
              numberOfLines={1}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {trailing}
            </Text>
          ) : null}
        </View>
      ) : null}
      {external ? (
        <Icon name="arrow-up-right" size={15} color={colors.textWeaker} />
      ) : showChevron ? (
        <Icon
          name="chevron-right"
          size={15}
          color={colors.textWeaker}
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    page: {
      flex: 1,
    },
    titleRow: {
      paddingTop: 6,
    },
    drawerTitleRow: {
      height: SIDEBAR_BRAND_ROW,
      justifyContent: "center",
    },
    title: {
      color: colors.text,
      fontFamily: fonts.display.semiBold,
      fontSize: 27,
      letterSpacing: -0.6,
    },
    firstSection: {
      height: 22,
    },
    pageSubHeader: {
      marginBottom: 22,
      paddingTop: 4,
    },
    pageSubTitle: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 30,
      letterSpacing: -1,
      lineHeight: 38,
    },
    identityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 48,
      paddingVertical: 4,
    },
    monogram: {
      alignItems: "center",
      backgroundColor: colors.surfaceInset,
      borderRadius: 19,
      height: 38,
      justifyContent: "center",
      width: 38,
    },
    monogramText: {
      color: colors.text,
      fontFamily: fonts.sans.bold,
      fontSize: 15,
      letterSpacing: -0.2,
    },
    identityCopy: {
      flex: 1,
      gap: 2,
      minWidth: 0,
    },
    identityPrimary: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 17,
      letterSpacing: -0.3,
    },
    identitySecondary: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 14,
    },
    navList: {
      gap: 2,
      marginTop: 2,
    },
    navRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 50,
    },
    subtleNavRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 46,
    },
    navPressed: {
      opacity: 0.55,
      transform: [{ scale: 0.985 }],
    },
    navLabelLine: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 8,
      minWidth: 0,
    },
    navLabel: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 21,
      letterSpacing: -0.5,
    },
    subtleNavLabel: {
      color: colors.text,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.35,
    },
    navMetaWrap: {
      alignItems: "center",
      flexDirection: "row",
      flexShrink: 1,
      gap: 7,
      maxWidth: "46%",
    },
    navMeta: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      fontVariant: ["tabular-nums"],
      letterSpacing: -0.2,
    },
    swatchDot: {
      borderRadius: 5,
      height: 10,
      width: 10,
    },
    toggleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 54,
      paddingVertical: 6,
    },
    toggleLabel: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 19,
      letterSpacing: -0.4,
    },
    dimmed: {
      opacity: 0.5,
    },
    footerActions: {
      gap: 2,
    },
    footerActionRow: {
      justifyContent: "center",
      minHeight: 44,
    },
    signOutText: {
      color: colors.text,
      fontFamily: fonts.sans.semiBold,
      fontSize: 18,
      letterSpacing: -0.35,
    },
    deleteAccountText: {
      color: colors.danger,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15.5,
      letterSpacing: -0.2,
    },
  });
