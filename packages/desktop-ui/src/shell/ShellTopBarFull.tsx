/**
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
import {
  displayTabs,
  useDisplayPanelOpen,
} from "@/features/workspace-display/tab-store";
import { SettingsMenuButton } from "@/shell/SettingsMenuButton";
import { ShellTopBarActivity } from "@/shell/ShellTopBarActivity";
import { ShellTopBarAccount } from "@/shell/sidebar/ShellTopBarAccount";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { ShellTopBarPrimaryNav } from "@/shell/sidebar/ShellTopBarNav";
import { ShellTopBarUpdatePill } from "@/shell/ShellTopBarUpdatePill";
import { WindowControls } from "@/shell/WindowControls";
import { PanelRight } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import "./shell-topbar-full.css";

const OMITTED_NAV_IDS = ["chat"] as const;

type ShellTopBarFullProps = {
  onSignIn?: () => void;
};

export const ShellTopBarFull = memo(function ShellTopBarFull({ onSignIn }: ShellTopBarFullProps) {
  const t = useT();
  const platform = getPlatform();
  const isMac = platform === "darwin";
  const isWin = platform === "win32";
  const panelOpen = useDisplayPanelOpen();
  const { hasConnectedAccount } = useAuthSessionState();

  return (
    <header
      className="shell-topbar-full"
      data-platform={isMac ? "mac" : isWin ? "win" : "other"}
      data-display-open={panelOpen ? "true" : "false"}
    >
      <div className="shell-topbar-full__left">
        <ShellTopBarPrimaryNav omitIds={OMITTED_NAV_IDS} />
      </div>

      <ShellTopBarActivity />

      <div className="shell-topbar-full__right">
        <ShellTopBarUpdatePill />
        <ShellTopBarAccount onSignIn={onSignIn} />
        {!panelOpen ? (
          <>
            {!hasConnectedAccount ? (
              <SettingsMenuButton className="shell-topbar-account-settings" />
            ) : null}
            <button
              type="button"
              className="shell-topbar-icon-btn"
              onClick={() => displayTabs.setPanelOpen(true)}
              aria-label={t("shell.displayPanel.openPanel")}
              title={t("shell.displayPanel.openPanel")}
            >
              <PanelRight size={16} strokeWidth={1.75} />
            </button>
          </>
        ) : null}
        {isWin && !panelOpen ? (
          <WindowControls useWindowsIcons />
        ) : null}
      </div>
    </header>
  );
});
