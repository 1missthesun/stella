import { Fragment, useRef, useState } from "react";
import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { useSelfHostedServer } from "@/platform/backend/server-discovery";
import { useT } from "@/shared/i18n";
import { preloadAuthDialog, preloadBillingScreen } from "@/shell/topbar/nav-surface-preloads";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useCurrentUser } from "@/global/auth/hooks/use-current-user";
import { useNickname } from "@/global/auth/hooks/use-nickname";
import { openSignOutDialog } from "@/global/auth/SignOutDialog";
import { useAuthBootstrapState } from "@/global/auth/BackendAuthProvider";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { DropdownMenu, Icons, MenuItem, MenuSeparator } from "../../kit";
import { fontSize, look, useTokens } from "../../theme";
import { GroupIcon, TopbarButton } from "../topbar/chrome";
import { useSettingsMenu, type SettingsDestination } from "../topbar/use-settings-menu";

const LABEL = look(fontSize.sm, 500, { lh: 1 });

/** `.shell-topbar-nav-hint-dot` on an icon. */
export function HintDot({ top = -3, right = -3, size = 6, ring }: { top?: number; right?: number; size?: number; ring: string }) {
  const t = useTokens();
  return <box absolute={{ top, right }} w={size} h={size} radius={size / 2} fill={t.c.destructive} shadows={[{ spread: 1.5, color: ring }]} inert />;
}

/** The settings menu's items (desktop-ui's `.shell-settings-menu`), with Plan & usage after Settings. */
export function SettingsMenuItems({ destinations, withPlan }: { destinations: SettingsDestination[]; withPlan: boolean }) {
  const t = useTokens();
  return (
    <>
      {destinations.map(({ id, label, icon, onSelect, hint }, index) => (
        <Fragment key={id}>
          <MenuItem id={`settings-menu-${id}`} icon={icon} onSelect={onSelect} trailing={hint ? <HintDot ring={t.c.overlayTop} /> : undefined}>
            {label}
          </MenuItem>
          {index === 0 && withPlan ? (
            <MenuItem id="settings-menu-plan" icon={Icons.stella.CreditCard} onSelect={() => planUsageDialog.open()}>
              Plan &amp; usage
            </MenuItem>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}

/** desktop-ui's `ShellTopBarAccount`: Sign in, or the account's name with the settings menu. */
export const ShellTopBarAccount = ({ onSignIn }: { onSignIn?: () => void }) => {
  const t = useT();
  const tk = useTokens();
  const { user: accountUser, hasConnectedAccount } = useCurrentUser();
  const { user: sessionUser } = useAuthSessionState();
  const { nickname } = useNickname();
  const sessionPaused = useAuthBootstrapState().status === "reauth_required";
  const selfHosted = useSelfHostedServer();
  const [open, setOpen] = useState(false);
  const pendingSignOutRef = useRef(false);
  const { destinations, connectHint, applyPendingPopover, popovers } = useSettingsMenu("shell-topbar-account");
  const user = { email: accountUser?.email ?? sessionUser?.email ?? undefined, name: accountUser?.name ?? sessionUser?.name ?? undefined };

  if (!hasConnectedAccount) {
    return (
      <TopbarButton
        id="shell-topbar-account-signin"
        label={t("sidebar.signIn")}
        title={t("sidebar.signIn")}
        icon={false}
        onHover={(inside) => inside && preloadAuthDialog()}
        onPress={() => {
          preloadAuthDialog();
          onSignIn?.();
        }}
      >
        {(color) => (
          <>
            <GroupIcon icon={Icons.nav.CustomLogIn} size={17} strokeWidth={1.55} color={color} hoverColor={tk.c.textStrong} />
            <text {...LABEL} nowrap color={color} hoverColor={tk.c.textStrong}>{t("sidebar.signIn")}</text>
          </>
        )}
      </TopbarButton>
    );
  }

  const accountName = (user.name ?? user.email ?? t("sidebar.account")).trim() || t("sidebar.account");
  const displayLabel = nickname.trim() || accountName;
  const pausedLabel = sessionPaused ? t("global.sessionPaused.accountLabel") : null;
  const nameTitle = displayLabel === accountName ? accountName : `${displayLabel} · ${accountName}`;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) return;
    queueMicrotask(() => {
      if (applyPendingPopover()) return;
      if (!pendingSignOutRef.current) return;
      pendingSignOutRef.current = false;
      openSignOutDialog();
    });
  };

  return (
    <row id="shell-topbar-account" h="full" align="center" gap={8} shrink minW={0} maxW={Math.min(240, window.innerWidth * 0.32)} noWindowDrag>
      <DropdownMenu
        id="shell-settings-menu"
        open={open}
        onOpenChange={onOpenChange}
        side="bottom"
        align="end"
        sideOffset={8}
        minW={212}
        trigger={(trigger) => (
          <TopbarButton id={trigger.id} label={pausedLabel ? `${displayLabel}, ${pausedLabel}` : displayLabel} title={pausedLabel ? `${nameTitle} · ${pausedLabel}` : nameTitle} icon={false} active={open} onPress={trigger.toggle} onHover={(inside) => inside && preloadBillingScreen()}>
            {(color) => (
              <>
                <box>
                  <GroupIcon icon={Icons.stella.Settings} size={15} strokeWidth={1.75} color={color} hoverColor={tk.c.textStrong} />
                  {connectHint.active ? <HintDot ring={tk.c.background} /> : null}
                </box>
                <row gap={6} align="end" minW={0} shrink inert>
                  <text {...LABEL} nowrap truncate maxW={160} color={color} hoverColor={tk.c.textStrong}>{displayLabel}</text>
                  {pausedLabel ? <text {...LABEL} nowrap color={tk.c.textWeak}>{pausedLabel}</text> : null}
                </row>
              </>
            )}
          </TopbarButton>
        )}
      >
        <SettingsMenuItems destinations={destinations} withPlan={!selfHosted} />
        <MenuSeparator />
        {sessionPaused ? (
          <MenuItem id="settings-menu-sign-in" icon={Icons.nav.CustomLogIn} onSelect={SIGN_IN_TOAST_ACTION.onClick}>
            {t("common.signIn")}
          </MenuItem>
        ) : null}
        <MenuItem id="settings-menu-sign-out" icon={Icons.stella.LogOut} destructive onSelect={() => void (pendingSignOutRef.current = true)}>
          {t("common.signOut")}
        </MenuItem>
      </DropdownMenu>
      {popovers}
    </row>
  );
};
