import { planUsageDialog } from "@/global/billing/plan-usage-dialog-store";
import { useSelfHostedServer } from "@/platform/backend/server-discovery";
import { Fragment, useRef } from "react";
import { CreditCard, LogOut, Settings } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import {
  preloadAuthDialog,
  preloadBillingScreen,
} from "@/shell/topbar/nav-surface-preloads";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useCurrentUser } from "@/global/auth/hooks/use-current-user";
import { useNickname } from "@/global/auth/hooks/use-nickname";
import { openSignOutDialog } from "@/global/auth/SignOutDialog";
import { useAuthBootstrapState } from "@/global/auth/BackendAuthProvider";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { CustomLogIn as LogIn } from "@/ui/nav-icons";
import { useSettingsMenu } from "@/shell/topbar/use-settings-menu";
import "./topbar-nav.css";
import "./account-dialogs.css";

interface ShellTopBarAccountProps {
  onSignIn?: () => void;
}

export const ShellTopBarAccount = ({ onSignIn }: ShellTopBarAccountProps) => {
  const t = useT();
  const { user: accountUser, hasConnectedAccount } = useCurrentUser();
  const { user: sessionUser } = useAuthSessionState();
  const { nickname } = useNickname();
  const sessionPaused = useAuthBootstrapState().status === "reauth_required";
  const user = {
    email: accountUser?.email ?? sessionUser?.email ?? undefined,
    name: accountUser?.name ?? sessionUser?.name ?? undefined,
  };

  const selfHosted = useSelfHostedServer();

  const pendingSignOutRef = useRef(false);

  const {
    destinations: settingsDestinations,
    connectHint,
    applyPendingPopover,
    popovers: settingsPopovers,
  } = useSettingsMenu();

  const handleDropdownCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    if (applyPendingPopover()) return;
    if (!pendingSignOutRef.current) return;
    pendingSignOutRef.current = false;
    openSignOutDialog();
  };

  if (!hasConnectedAccount) {
    return (
      <div className="shell-topbar-account">
        <button
          type="button"
          className="shell-topbar-account-signin"
          onClick={() => {
            preloadAuthDialog();
            onSignIn?.();
          }}
          onFocus={preloadAuthDialog}
          onMouseEnter={preloadAuthDialog}
          title={t("sidebar.signIn")}
          aria-label={t("sidebar.signIn")}
        >
          <span className="shell-topbar-account-signin-icon">
            <LogIn size={17} strokeWidth={1.55} />
          </span>
          <span className="shell-topbar-account-signin-label">
            {t("sidebar.signIn")}
          </span>
        </button>
      </div>
    );
  }

  const accountName =
    (user.name ?? user.email ?? t("sidebar.account")).trim() ||
    t("sidebar.account");
  const displayLabel = nickname.trim() || accountName;
  const pausedLabel = sessionPaused
    ? t("global.sessionPaused.accountLabel")
    : null;
  const nameTitle =
    displayLabel === accountName
      ? accountName
      : `${displayLabel} · ${accountName}`;

  return (
    <div className="shell-topbar-account">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="shell-topbar-account-trigger"
            title={pausedLabel ? `${nameTitle} · ${pausedLabel}` : nameTitle}
            aria-label={
              pausedLabel ? `${displayLabel}, ${pausedLabel}` : displayLabel
            }
          >
            {/* The gear only says "this opens settings": the whole button is
                the one target for the menu. */}
            <span
              className="shell-topbar-account-settings-icon"
              aria-hidden="true"
            >
              <Settings size={15} strokeWidth={1.75} />
              {connectHint.active ? (
                <span className="shell-topbar-nav-hint-dot" aria-hidden="true" />
              ) : null}
            </span>
            <span className="shell-topbar-account-identity">
              <span className="shell-topbar-account-nickname">
                {displayLabel}
              </span>
              {pausedLabel ? (
                <span className="shell-topbar-account-status">
                  {pausedLabel}
                </span>
              ) : null}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="shell-settings-menu"
          side="bottom"
          align="end"
          sideOffset={8}
          onCloseAutoFocus={handleDropdownCloseAutoFocus}
        >
          {settingsDestinations.map(
            ({ id, label, Icon, onSelect, hint }, index) => (
              <Fragment key={id}>
                <DropdownMenuItem onSelect={onSelect}>
                  <span data-slot="dropdown-menu-item-icon">
                    <Icon size={15} strokeWidth={1.75} />
                    {hint ? (
                      <span
                        className="shell-topbar-nav-hint-dot shell-settings-menu-item-hint-dot"
                        aria-hidden="true"
                      />
                    ) : null}
                  </span>
                  {label}
                </DropdownMenuItem>
                {index === 0 && !selfHosted ? (
                  <DropdownMenuItem
                    onClick={() => planUsageDialog.open()}
                    onMouseEnter={preloadBillingScreen}
                    onFocus={preloadBillingScreen}
                  >
                    <span data-slot="dropdown-menu-item-icon">
                      <CreditCard size={15} strokeWidth={1.75} />
                    </span>
                    Plan &amp; usage
                  </DropdownMenuItem>
                ) : null}
              </Fragment>
            ),
          )}
          <DropdownMenuSeparator />
          {sessionPaused ? (
            <DropdownMenuItem onClick={SIGN_IN_TOAST_ACTION.onClick}>
              <span data-slot="dropdown-menu-item-icon">
                <LogIn size={15} strokeWidth={1.75} />
              </span>
              {t("common.signIn")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            data-variant="destructive"
            onClick={() => {
              pendingSignOutRef.current = true;
            }}
          >
            <span data-slot="dropdown-menu-item-icon">
              <LogOut size={15} strokeWidth={1.75} />
            </span>
            {t("common.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {settingsPopovers}
    </div>
  );
};
