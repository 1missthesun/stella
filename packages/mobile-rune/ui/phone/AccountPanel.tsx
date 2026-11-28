import { useState } from "react";
import { resolveThemeColors } from "../../../theme";
import { useTheme } from "@/context/theme-context";
import { useCloudBrowserActions } from "@/features/cloud/use-cloud-browser-interactions";
import { accountHintChanged } from "@/global/auth/hooks/use-account-hint";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { secureSignOut } from "@/global/auth/services/auth";
import { deleteAuthUser } from "@/global/auth/services/auth-session";
import { clearCachedToken } from "@/global/auth/services/auth-token";
import { useSelfHostedServer, useServerDiscovery, useServerFeature } from "@/platform/backend/server-discovery";
import { openExternalUrl } from "@/platform/electron/open-external";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { useT } from "@/shared/i18n";
import { Icon } from "../../../desktop-rune/ui/kit";
import { AppearancePage } from "./account/AppearancePage";
import { FeedbackSheet } from "./account/FeedbackSheet";
import { DrawerPage, Rise, tapLight } from "./account/kit";
import { MemoryPage } from "./account/MemoryPage";
import { NotificationsPage, urgencyLabelKey, useUserAskPolicy } from "./account/NotificationsPage";
import { SubscriptionPage, SubscriptionSummaryCard } from "./account/SubscriptionPage";
import { phoneAlert, phoneSheet } from "./ask";
import { glyph } from "./icons";
import type { PhoneInsets } from "./insets";
import { DrawerTitle, Hairline, NavRow, PanelPageHeader, PRESS, SectionLabel, TEXT, useRn } from "./rn";
import { useWarmMount } from "./stage";

// packages/mobile's SettingsContent in the left drawer: who is signed in, the plan, the App,
// Cloud Home and About sections, Sign out and Delete account, with each setting on its own page.

type Page = "root" | "subscription" | "appearance" | "notifications" | "memory";

const SITE_URL = ((import.meta.env.VITE_STELLA_WEB_URL as string | undefined)?.trim() || "https://stella.sh").replace(/\/+$/, "");

const initialFor = (name: string, email: string): string => {
  const match = (name || email).trim().match(/[A-Za-z0-9]/u);
  return match ? match[0].toUpperCase() : "S";
};

const errorText = (e: unknown): string => (e instanceof Error && e.message ? e.message : String(e));

const signIn = () => SIGN_IN_TOAST_ACTION.onClick();

export function AccountPanel({ showing, open, insets }: { showing: boolean; open: boolean; width: number; insets: PhoneInsets }) {
  const mounted = useWarmMount(showing);
  if (!mounted) return null;
  return <AccountPages showing={showing} open={open} insets={insets} />;
}

function AccountPages({ showing, open, insets }: { showing: boolean; open: boolean; insets: PhoneInsets }) {
  const t = useT();
  const [page, setPage] = useState<Page>("root");
  const [moved, setMoved] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rise, setRise] = useState({ open, gen: 0 });
  if (rise.open !== open) setRise({ open, gen: open ? rise.gen + 1 : rise.gen });
  if (!showing && (page !== "root" || moved)) {
    setPage("root");
    setMoved(false);
  }

  const { user, hasConnectedAccount } = useAuthSessionState();
  const signedIn = Boolean(user) && hasConnectedAccount;
  const escalation = useUserAskPolicy(signedIn, showing);

  const go = (next: Page) => {
    tapLight();
    setMoved(true);
    setPage(next);
  };

  const pageTitle =
    page === "subscription"
      ? t("billing.mobile.sectionTitle")
      : page === "appearance"
        ? t("mobile.settings.appearanceSection")
        : page === "notifications"
          ? t("mobile.settings.notificationsSection")
          : t("mobile.cloudHome.title");

  return (
    <col grow={1} minH={0} w="full">
      {page === "root" ? (
        <DrawerPage key="root" id="phone-account-root" insets={insets} enter={moved ? "left" : undefined}>
          <AccountRoot play={open && !moved} odd={rise.gen % 2 === 1} escalationLabel={signedIn && escalation.available ? t(urgencyLabelKey(escalation.policy.ceiling)) : undefined} onOpen={go} onFeedback={() => setFeedbackOpen(true)} />
        </DrawerPage>
      ) : (
        <DrawerPage key={`sub:${page}`} id={`phone-account-${page}`} insets={insets} enter="right">
          <PanelPageHeader back={t("mobile.nav.account")} onBack={() => go("root")} title={pageTitle} />
          {page === "subscription" ? <SubscriptionPage /> : null}
          {page === "appearance" ? <AppearancePage /> : null}
          {page === "notifications" ? <NotificationsPage view={escalation} /> : null}
          {page === "memory" ? <MemoryPage signedIn={signedIn} onSignIn={signIn} /> : null}
        </DrawerPage>
      )}
      <FeedbackSheet open={feedbackOpen} insets={insets} onClose={() => setFeedbackOpen(false)} />
    </col>
  );
}

function AccountRoot({
  play,
  odd,
  escalationLabel,
  onOpen,
  onFeedback,
}: {
  play: boolean;
  odd: boolean;
  escalationLabel: string | undefined;
  onOpen: (page: Page) => void;
  onFeedback: () => void;
}) {
  const c = useRn();
  const t = useT();
  const { user, isLoading } = useAuthSessionState();
  const theme = useTheme();
  const discovery = useServerDiscovery();
  const selfHosted = useSelfHostedServer();
  const billing = useServerFeature("billing");
  const push = useServerFeature("push");
  const { resetProfile } = useCloudBrowserActions();
  const [resetting, setResetting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const signedIn = Boolean(user);
  const userName = user?.name?.trim() ?? "";
  const email = selfHosted ? t("mobile.selfHost.ownerOf", { name: discovery?.name ?? "" }) : (user?.email ?? "");
  const activeTheme = theme.themes.find((th) => th.id === theme.selectedThemeId) ?? theme.themes[0];
  const activePrimary = activeTheme ? resolveThemeColors(activeTheme, theme.resolvedColorMode === "dark").colors.primary : null;
  const appearanceValue = t(`mobile.settings.appearance.${theme.colorMode}`);
  const busy = signingOut || deleting;

  const resetCloudBrowser = async () => {
    const choice = await phoneSheet({
      title: t("cloudBrowser.settings.confirmTitle"),
      message: t("cloudBrowser.settings.confirmBody"),
      actions: [{ id: "reset", label: t("cloudBrowser.settings.reset") }],
      destructive: "reset",
      cancel: t("mobile.common.cancel"),
      alert: true,
    });
    if (choice !== "reset") return;
    setResetting(true);
    let done = true;
    try {
      await resetProfile();
    } catch {
      done = false;
    } finally {
      setResetting(false);
    }
    void phoneAlert(t("cloudBrowser.settings.title"), t(done ? "cloudBrowser.settings.resetComplete" : "cloudBrowser.settings.resetFailed"), t("common.gotIt"));
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await secureSignOut("current_device");
      accountHintChanged();
    } catch (e) {
      void phoneAlert(t("mobile.settings.signOutLabel"), errorText(e), t("common.gotIt"));
    } finally {
      setSigningOut(false);
    }
  };

  const runDelete = async (): Promise<void> => {
    setDeleting(true);
    let scheduled: boolean;
    try {
      ({ scheduled } = await deleteAuthUser());
    } catch (e) {
      setDeleting(false);
      const retry = await phoneSheet({
        title: t("mobile.settings.deleteFailedTitle"),
        message: `${t("mobile.settings.deleteFailedBody")}\n\n${errorText(e)}`,
        actions: [{ id: "retry", label: t("mobile.settings.deleteRetry") }],
        destructive: "retry",
        cancel: t("mobile.common.cancel"),
        alert: true,
      });
      if (retry === "retry") await runDelete();
      return;
    }
    clearCachedToken();
    accountHintChanged();
    setDeleting(false);
    void phoneAlert(
      t(scheduled ? "mobile.settings.deletionScheduledTitle" : "mobile.settings.deleteConfirmTitle"),
      t(scheduled ? "settings.account.toasts.deletionScheduled" : "settings.account.toasts.accountDeleted"),
      t("common.gotIt"),
    );
  };

  const confirmDelete = async () => {
    const choice = await phoneSheet({
      title: t("mobile.settings.deleteConfirmTitle"),
      message: t("mobile.settings.deleteConfirmBody"),
      actions: [{ id: "delete", label: t("mobile.common.delete") }],
      destructive: "delete",
      cancel: t("mobile.common.cancel"),
      alert: true,
    });
    if (choice === "delete") await runDelete();
  };

  let i = 0;

  return (
    <>
      <Rise i={i++} play={play} odd={odd}>
        <DrawerTitle>{t("mobile.nav.account")}</DrawerTitle>
      </Rise>

      <Rise i={i++} play={play} odd={odd}>
        <box h={22} />
        {signedIn ? (
          <row id="phone-account-identity" minH={48} py={4} gap={12} align="center">
            <box w={38} h={38} radius={19} fill={c.surfaceInset} center shrink={false}>
              <text {...TEXT.monogram} color={c.text} maxLines={1}>
                {initialFor(userName, email)}
              </text>
            </box>
            <col grow={1} minW={0} gap={2}>
              {userName ? (
                <text {...TEXT.identityPrimary} color={c.text} maxLines={1}>
                  {userName}
                </text>
              ) : null}
              {email ? (
                <text {...(userName ? TEXT.identitySecondary : TEXT.identityPrimary)} color={userName ? c.textMuted : c.text} nowrap truncate="middle" selectable>
                  {email}
                </text>
              ) : null}
            </col>
          </row>
        ) : isLoading ? (
          <text {...TEXT.hint} color={c.textMuted}>
            {t("mobile.settings.loadingSession")}
          </text>
        ) : (
          <row
            id="phone-account-sign-in"
            role="button"
            label={t("mobile.settings.signInTitle")}
            focusable
            minH={48}
            py={4}
            gap={12}
            align="center"
            {...PRESS}
            onPress={() => {
              tapLight();
              signIn();
            }}
          >
            <box w={38} h={38} radius={19} fill={c.surfaceInset} center shrink={false}>
              <Icon icon={glyph("person-circle")} size={18} color={c.accent} />
            </box>
            <text {...TEXT.navLabel} color={c.accent} grow={1} maxLines={1}>
              {t("mobile.settings.signIn")}
            </text>
            <Icon icon={glyph("chevron-right")} size={15} color={c.textMuted} />
          </row>
        )}
      </Rise>

      {signedIn && billing ? (
        <Rise i={i++} play={play} odd={odd}>
          <Hairline space={18} />
          <SubscriptionSummaryCard onPress={() => onOpen("subscription")} />
        </Rise>
      ) : null}

      <Rise i={i++} play={play} odd={odd}>
        <Hairline space={20} />
        <SectionLabel>{t("settings.groups.app")}</SectionLabel>
        <col gap={2} mt={2}>
          <NavRow
            id="phone-account-appearance"
            label={t("mobile.settings.appearanceSection")}
            trailing={appearanceValue}
            trailingDot={activePrimary ? <box w={10} h={10} radius={5} fill={activePrimary} shrink={false} /> : undefined}
            onPress={() => onOpen("appearance")}
          />
          {push || signedIn ? <NavRow id="phone-account-notifications" label={t("mobile.settings.notificationsSection")} trailing={escalationLabel} onPress={() => onOpen("notifications")} /> : null}
        </col>
      </Rise>

      {signedIn ? (
        <Rise i={i++} play={play} odd={odd}>
          <Hairline space={20} />
          <SectionLabel>{t("mobile.cloudHome.settingsSection")}</SectionLabel>
          <col gap={2} mt={2}>
            <NavRow id="phone-account-memory" label={t("settings.memory.title")} chevron onPress={() => onOpen("memory")} />
            <row minH={54} py={6} gap={12} align="center">
              <col grow={1} minW={0} gap={3}>
                <text {...TEXT.toggleLabel} color={c.text} maxLines={1}>
                  {t("cloudBrowser.settings.defaultProfile")}
                </text>
                <text {...TEXT.rowSub} color={c.textMuted} maxLines={2}>
                  {t("cloudBrowser.settings.description")}
                </text>
              </col>
              <box
                id="phone-account-reset-browser"
                role="button"
                label={t("cloudBrowser.settings.reset")}
                focusable={!resetting}
                disabled={resetting}
                opacity={resetting ? 0.5 : 1}
                pressScale={0.97}
                onPress={resetting ? undefined : () => void resetCloudBrowser()}
              >
                <text {...TEXT.danger} color={c.danger}>
                  {resetting ? t("cloudBrowser.settings.resetting") : t("cloudBrowser.settings.reset")}
                </text>
              </box>
            </row>
          </col>
        </Rise>
      ) : null}

      <Rise i={i++} play={play} odd={odd}>
        <Hairline space={20} />
        <SectionLabel>{t("mobile.settings.aboutSection")}</SectionLabel>
        <col gap={2} mt={2}>
          {signedIn && !selfHosted ? (
            <NavRow
              id="phone-account-feedback"
              label={t("sidebar.feedback")}
              subtle
              onPress={() => {
                tapLight();
                onFeedback();
              }}
            />
          ) : null}
          <NavRow id="phone-account-terms" label={t("mobile.settings.termsOfService")} subtle external onPress={() => openExternalUrl(`${SITE_URL}/terms`)} />
          <NavRow id="phone-account-privacy" label={t("mobile.settings.privacyPolicy")} subtle external onPress={() => openExternalUrl(`${SITE_URL}/privacy`)} />
        </col>
      </Rise>

      {signedIn ? (
        <Rise i={i++} play={play} odd={odd}>
          <Hairline space={20} />
          <col gap={2}>
            <row
              id="phone-account-sign-out"
              role="button"
              label={t("mobile.settings.signOutLabel")}
              focusable={!busy}
              disabled={busy}
              minH={44}
              align="center"
              opacity={busy ? 0.42 : 1}
              {...PRESS}
              onPress={busy ? undefined : () => void signOut()}
            >
              <text {...TEXT.signOut} color={c.text}>
                {signingOut ? t("mobile.settings.signingOut") : t("mobile.settings.signOut")}
              </text>
            </row>
            {selfHosted ? null : (
              <row
                id="phone-account-delete"
                role="button"
                label={t("mobile.settings.deleteAccountLabel")}
                focusable={!busy}
                disabled={busy}
                minH={44}
                align="center"
                pressScale={0.97}
                onPress={busy ? undefined : () => void confirmDelete()}
              >
                <text {...TEXT.danger} color={c.danger}>
                  {deleting ? t("mobile.settings.deletingAccount") : t("mobile.settings.deleteAccount")}
                </text>
              </row>
            )}
          </col>
        </Rise>
      ) : null}
    </>
  );
}
