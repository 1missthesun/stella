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
import { Text } from "./Text";
import { useRouter } from "expo-router";
import { resolveThemeColors } from "@stella/theme";
import { USER_ASK_URGENCY_NAMES } from "@stella/contracts/user-ask";
import { GlassToggle } from "./glass";
import { Icon, type IconName } from "./Icon";
import {
  SubscriptionSection,
  SubscriptionSummaryCard,
} from "./SubscriptionSection";
import { FeedbackSheet } from "./FeedbackSheet";
import { AppearanceSubView } from "./settings/AppearanceSubView";
import { SettingsScroll } from "./settings/SettingsScroll";
import { SIDEBAR_BRAND_ROW } from "./sidebar/SidebarPanel";
import { UserAskEscalationSection } from "./settings/UserAskEscalationSection";
import { SavedLoginsSection } from "./settings/SavedLoginsSection";
import { ServerSection } from "./settings/ServerSection";
import {
  makeSettingsStyles,
  settingsSurfaceFills,
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
import { useSavedValuesTrust } from "../lib/saved-values-trust";
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
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const settingsStyles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const session = authClient.useSession();
  const features = useServerFeatures();
  const savedLoginsTrust = useSavedValuesTrust();
  const [subpage, setSubpage] = useState<AccountSubpage | null>(null);
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
    if (!active) setSubpage(null);
  }, [active]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [subpage]);

  useEffect(() => {
    if (inDrawer || subpage === null) return;
    publishBackOverride({
      label: t("mobile.nav.account"),
      onPress: () => setSubpage(null),
    });
    return () => {
      publishBackOverride(null);
    };
  }, [inDrawer, subpage, t]);

  useEffect(() => {
    if (subpage === null) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSubpage(null);
      return true;
    });
    return () => sub.remove();
  }, [subpage]);

  const openSubpage = (next: AccountSubpage) => {
    tapLight();
    setSubpage(next);
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
  const savedLoginsAttention =
    savedLoginsTrust.standing === "waiting" ||
    savedLoginsTrust.standing === "problem" ||
    (savedLoginsTrust.standing === "member" &&
      savedLoginsTrust.requests.length > 0);
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
      <SettingsScroll ref={scrollRef} inDrawer={inDrawer}>
        <View style={styles.subHeader}>
          {inDrawer ? (
            <Pressable
              testID="account-subpage-back"
              onPress={() => {
                tapLight();
                setSubpage(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("mobile.nav.account")}
              hitSlop={8}
              style={({ pressed }) => [
                styles.subBackBtn,
                pressed && settingsStyles.rowPressed,
              ]}
            >
              <Icon name="chevron-left" size={16} color={colors.textMuted} />
              <Text style={styles.subBackText}>{t("mobile.nav.account")}</Text>
            </Pressable>
          ) : null}
          <Text
            style={styles.title}
            accessibilityRole="header"
            testID={`account-subpage-${subpage}`}
          >
            {subpageTitle}
          </Text>
        </View>

        {subpage === "subscription" ? <SubscriptionSection embedded /> : null}

        {subpage === "appearance" ? (
          <AppearanceSubView styles={settingsStyles} />
        ) : null}

        {subpage === "notifications" ? (
          <>
            {features.push ? (
              <View style={settingsStyles.sectionFirst}>
                <View style={settingsStyles.group}>
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
                </View>
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
    );
  }

  return (
    <SettingsScroll ref={scrollRef} inDrawer={inDrawer}>
      <View style={inDrawer ? styles.drawerTitleRow : styles.titleRow}>
        <Text
          style={styles.title}
          accessibilityRole="header"
          maxFontSizeMultiplier={inDrawer ? 1 : undefined}
        >
          {t("mobile.nav.account")}
        </Text>
      </View>

      <View style={styles.identitySection}>
        {isSignedIn ? (
          <View style={styles.identityRow}>
            <View style={styles.monogram}>
              <Text style={styles.monogramText}>
                {initialFor(userName, email)}
              </Text>
            </View>
            <View style={settingsStyles.rowCopy}>
              {userName ? (
                <Text style={styles.identityPrimary} numberOfLines={1}>
                  {userName}
                </Text>
              ) : null}
              {email ? (
                <Text
                  style={
                    userName ? styles.identitySecondary : styles.identityPrimary
                  }
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  selectable
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
              styles.signInCard,
              pressed && settingsStyles.rowPressed,
            ]}
          >
            <View style={styles.monogram}>
              <Icon name="user" size={17} color={colors.accent} />
            </View>
            <Text
              style={[
                settingsStyles.rowLabel,
                styles.flex,
                { color: colors.accent },
              ]}
            >
              {t("mobile.settings.signIn")}
            </Text>
            <Icon name="chevron-right" size={14} color={colors.textWeaker} />
          </Pressable>
        )}

        {isSignedIn && features.billing ? (
          <SubscriptionSummaryCard onPress={() => openSubpage("subscription")} />
        ) : null}
      </View>

      <View style={settingsStyles.section}>
        <Text style={settingsStyles.sectionLabel}>
          {t("settings.groups.app")}
        </Text>
        <View style={settingsStyles.group}>
          <NavRow
            testID="account-appearance-row"
            leading={
              activeThemePreview ? (
                <View style={settingsStyles.rowIcon}>
                  <View
                    style={[
                      styles.miniSwatch,
                      {
                        backgroundColor: activeThemePreview.background,
                        borderColor: activeThemePreview.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.miniSwatchCore,
                        { backgroundColor: activeThemePreview.primary },
                      ]}
                    />
                  </View>
                </View>
              ) : undefined
            }
            label={t("mobile.settings.appearanceSection")}
            trailing={appearanceValue}
            accessibilityLabel={`${t("mobile.settings.appearanceSection")}, ${appearanceValue}`}
            styles={settingsStyles}
            colors={colors}
            onPress={() => openSubpage("appearance")}
          />

          {showNotificationsRow ? (
            <NavRow
              testID="account-notifications-row"
              icon="bell"
              label={t("mobile.settings.notificationsSection")}
              trailing={notificationsValue}
              accessibilityLabel={
                notificationsValue
                  ? `${t("mobile.settings.notificationsSection")}, ${notificationsValue}`
                  : t("mobile.settings.notificationsSection")
              }
              divided
              styles={settingsStyles}
              colors={colors}
              onPress={() => openSubpage("notifications")}
            />
          ) : null}

          {features.realtimeVoice ? (
            <View style={[settingsStyles.row, settingsStyles.rowDivider]}>
              <Icon
                name="waveform"
                size={16}
                color={colors.textMuted}
                style={settingsStyles.rowIcon}
              />
              <View style={settingsStyles.rowCopy}>
                <Text style={settingsStyles.rowLabel}>
                  {t("settings.voiceAgent.title")}
                </Text>
                <Text style={settingsStyles.rowSub} numberOfLines={2}>
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
      </View>

      {showCloudSection ? (
        <View style={settingsStyles.section}>
          <Text style={settingsStyles.sectionLabel}>
            {t("mobile.cloudHome.settingsSection")}
          </Text>
          <View style={settingsStyles.group}>
            {isSignedIn ? (
              <NavRow
                testID="account-memory-row"
                icon="file-text"
                label={t("settings.memory.title")}
                accessibilityLabel={t("mobile.cloudHome.openSettingsLabel")}
                styles={settingsStyles}
                colors={colors}
                onPress={() => {
                  tapLight();
                  if (onOpenCloudHome) onOpenCloudHome();
                  else router.push("/cloud-home");
                }}
              />
            ) : null}

            {isSignedIn ? (
              <View style={[settingsStyles.row, settingsStyles.rowDivider]}>
                <Icon
                  name="globe"
                  size={16}
                  color={colors.textMuted}
                  style={settingsStyles.rowIcon}
                />
                <View style={settingsStyles.rowCopy}>
                  <Text style={settingsStyles.rowLabel} numberOfLines={1}>
                    {t("cloudBrowser.settings.defaultProfile")}
                  </Text>
                  <Text style={settingsStyles.rowSub} numberOfLines={2}>
                    {t("cloudBrowser.settings.description")}
                  </Text>
                </View>
                <Pressable
                  onPress={confirmResetCloudBrowser}
                  disabled={isResettingCloudBrowser}
                  hitSlop={8}
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

            {showSavedLogins ? (
              <NavRow
                testID="account-saved-logins-row"
                icon="key"
                label={t("mobile.savedLogins.section")}
                trailing={savedLoginsValue}
                attention={savedLoginsAttention}
                accessibilityLabel={t("mobile.savedLogins.section")}
                divided
                styles={settingsStyles}
                colors={colors}
                onPress={() => openSubpage("saved-logins")}
              />
            ) : null}

            {selfHostServersAvailable ? (
              <NavRow
                testID="account-server-row"
                icon="cloud"
                label={t("mobile.selfHost.serverSection")}
                trailing={activeServerName}
                accessibilityLabel={`${t("mobile.selfHost.serverSection")}, ${activeServerName}`}
                divided={isSignedIn}
                styles={settingsStyles}
                colors={colors}
                onPress={() => openSubpage("server")}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={settingsStyles.section}>
        <Text style={settingsStyles.sectionLabel}>
          {t("mobile.settings.aboutSection")}
        </Text>
        <View style={settingsStyles.group}>
          {showFeedback ? (
            <NavRow
              testID="account-feedback-row"
              label={t("sidebar.feedback")}
              accessibilityLabel={t("sidebar.feedback")}
              styles={settingsStyles}
              colors={colors}
              onPress={() => {
                tapLight();
                setFeedbackOpen(true);
              }}
            />
          ) : null}
          <NavRow
            label={t("mobile.settings.termsOfService")}
            accessibilityLabel={t("mobile.settings.openTermsLabel")}
            divided={showFeedback}
            external
            styles={settingsStyles}
            colors={colors}
            onPress={() => void Linking.openURL(`${env.siteUrl}/terms`)}
          />
          <NavRow
            label={t("mobile.settings.privacyPolicy")}
            accessibilityLabel={t("mobile.settings.openPrivacyLabel")}
            divided
            external
            styles={settingsStyles}
            colors={colors}
            onPress={() => void Linking.openURL(`${env.siteUrl}/privacy`)}
          />
        </View>
      </View>

      {isSignedIn ? (
        <View style={styles.footerActions}>
          <Pressable
            onPress={() => void signOut()}
            disabled={isSigningOut || isDeletingAccount}
            accessibilityRole="button"
            accessibilityLabel={t("mobile.settings.signOutLabel")}
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && settingsStyles.rowPressed,
              (isSigningOut || isDeletingAccount) && settingsStyles.rowDisabled,
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
                styles.deleteAccountLink,
                pressed && styles.dimmed,
              ]}
            >
              <Text style={styles.deleteAccountLinkText}>
                {isDeletingAccount
                  ? t("mobile.settings.deletingAccount")
                  : t("mobile.settings.deleteAccount")}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <FeedbackSheet
        visible={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </SettingsScroll>
  );
}

function NavRow({
  testID,
  icon,
  leading,
  label,
  sub,
  trailing,
  attention = false,
  external = false,
  accessibilityLabel,
  divided = false,
  styles,
  colors,
  onPress,
}: {
  testID?: string;
  icon?: IconName;
  leading?: ReactNode;
  label: string;
  sub?: string;
  trailing?: string;
  attention?: boolean;
  external?: boolean;
  accessibilityLabel: string;
  divided?: boolean;
  styles: SettingsStyles;
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
        styles.row,
        divided && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      {leading ? (
        leading
      ) : icon ? (
        <Icon
          name={icon}
          size={16}
          color={colors.textMuted}
          style={styles.rowIcon}
        />
      ) : null}
      <View style={styles.rowCopy}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      {trailing || attention ? (
        <View style={styles.rowTrailingWrap}>
          {attention ? <View style={styles.attentionDot} /> : null}
          {trailing ? (
            <Text style={styles.rowTrailing} numberOfLines={1}>
              {trailing}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Icon
        name={external ? "arrow-up-right" : "chevron-right"}
        size={external ? 13.5 : 14}
        color={colors.textWeaker}
      />
    </Pressable>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) => {
  const { subtleFill, tonalFill } = settingsSurfaceFills(isDark);
  return StyleSheet.create({
    titleRow: { marginTop: 6 },
    drawerTitleRow: {
      height: SIDEBAR_BRAND_ROW,
      justifyContent: "center",
    },
    title: {
      color: colors.textStrong,
      fontFamily: fonts.display.semiBold,
      fontSize: 26,
      letterSpacing: -0.9,
    },
    subHeader: {
      gap: 4,
      marginBottom: 4,
    },
    subBackBtn: {
      alignItems: "center",
      alignSelf: "flex-start",
      flexDirection: "row",
      gap: 4,
      height: SIDEBAR_BRAND_ROW,
      marginLeft: -4,
    },
    subBackText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 13.5,
    },
    identitySection: {
      marginTop: 14,
    },
    identityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12,
      minHeight: 44,
      paddingVertical: 4,
    },
    signInCard: {
      alignItems: "center",
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 12,
      minHeight: 56,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    monogram: {
      alignItems: "center",
      backgroundColor: tonalFill,
      borderColor: colors.borderWeak,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      height: 36,
      justifyContent: "center",
      width: 36,
    },
    monogramText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
    },
    identityPrimary: {
      color: colors.textStrong,
      fontFamily: fonts.sans.semiBold,
      fontSize: 15,
      letterSpacing: -0.25,
    },
    identitySecondary: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12.5,
    },
    miniSwatch: {
      alignItems: "center",
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      height: 18,
      justifyContent: "center",
      overflow: "hidden",
      width: 18,
    },
    miniSwatchCore: {
      borderRadius: 4,
      height: 8,
      width: 8,
    },
    dimmed: {
      opacity: 0.55,
    },
    flex: {
      flex: 1,
    },
    footerActions: {
      marginTop: 28,
    },
    signOutButton: {
      alignItems: "center",
      backgroundColor: subtleFill,
      borderColor: colors.borderWeak,
      borderRadius: 11,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: 16,
    },
    signOutText: {
      color: colors.textStrong,
      fontFamily: fonts.sans.medium,
      fontSize: 14.5,
      letterSpacing: -0.15,
    },
    deleteAccountLink: {
      alignSelf: "center",
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    deleteAccountLinkText: {
      color: colors.danger,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      letterSpacing: -0.1,
    },
  });
};
