/**
 * The left side carries the Chrome-style tabs (see ShellTopBarTabs) that
 * replaced the right sidebar's tab strip.
 *
 * Apps are deliberately absent from the nav: they now open inside the right
 * sidebar's Apps section rather than the main content area, so a nav entry
 * pointing at the `/apps` route would compete with the sidebar for the same
 * job. Home is also omitted from route navigation: background work is read
 * from the centred activity indicator here, which replaced the standalone
 * right-hand activity surface.
 *
 * Stella is a single-chat product, so the bar carries no conversation tabs,
 * history or new-chat control: the active conversation is chosen by the
 * root route (`?c=`) alone.
 */

import { memo } from "react";
import { getPlatform } from "@/platform/electron/platform";
import { SettingsMenuButton } from "@/shell/SettingsMenuButton";
import { ShellTopBarActivity } from "@/shell/ShellTopBarActivity";
import { ShellTopBarAccount } from "@/shell/sidebar/ShellTopBarAccount";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { ShellTopBarPrimaryNav } from "@/shell/sidebar/ShellTopBarNav";
import { ShellTopBarUpdatePill } from "@/shell/ShellTopBarUpdatePill";
import { WindowControls } from "@/shell/WindowControls";
import { ShellTopBarTabs } from "@/shell/topbar/ShellTopBarTabs";
import { GlobalModelsControl } from "@/shell/GlobalModelsControl";
import "./shell-topbar-full.css";

const OMITTED_NAV_IDS = ["chat"] as const;

type ShellTopBarFullProps = {
  onSignIn?: () => void;
};

export const ShellTopBarFull = memo(function ShellTopBarFull({ onSignIn }: ShellTopBarFullProps) {
  const platform = getPlatform();
  const isMac = platform === "darwin";
  const isWin = platform === "win32";
  const { hasConnectedAccount } = useAuthSessionState();

  return (
    <header
      className="shell-topbar-full shell-topbar-full--tabs"
      data-platform={isMac ? "mac" : isWin ? "win" : "other"}
    >
      <div className="shell-topbar-full__left">
        <ShellTopBarPrimaryNav omitIds={OMITTED_NAV_IDS} />
        <ShellTopBarTabs />
      </div>

      <ShellTopBarActivity />

      <div className="shell-topbar-full__right">
        <ShellTopBarUpdatePill />
        <GlobalModelsControl placement="topbar" />
        <ShellTopBarAccount onSignIn={onSignIn} />
        {!hasConnectedAccount ? (
          <SettingsMenuButton className="shell-topbar-account-settings" />
        ) : null}
        {isWin ? <WindowControls useWindowsIcons /> : null}
      </div>
    </header>
  );
});
