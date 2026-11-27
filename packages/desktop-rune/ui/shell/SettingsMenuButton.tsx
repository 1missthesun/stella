import { useState } from "react";
import { preloadSettingsScreen } from "@/shell/topbar/nav-surface-preloads";
import { useSettingsDialogOpen } from "@/shell/settings-dialog-store";
import { DropdownMenu, Icons } from "../kit";
import { useTokens } from "../theme";
import { GroupIcon, TopbarButton } from "./topbar/chrome";
import { useSettingsMenu } from "./topbar/use-settings-menu";
import { HintDot, SettingsMenuItems } from "./sidebar/ShellTopBarAccount";

/** desktop-ui's `SettingsMenuButton`: the gear with the settings menu (signed out). */
export function SettingsMenuButton({ id = "shell-topbar-account-settings", showActiveState = false }: { id?: string; showActiveState?: boolean }) {
  const t = useTokens();
  const settingsOpen = useSettingsDialogOpen();
  const [menuOpen, setMenuOpen] = useState(false);
  const { destinations, connectHint, applyPendingPopover, popovers } = useSettingsMenu(`${id}-trigger`);
  const active = settingsOpen || menuOpen;

  return (
    <row noWindowDrag>
      <DropdownMenu
        id={id}
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          if (!next) queueMicrotask(applyPendingPopover);
        }}
        side="bottom"
        align="end"
        sideOffset={8}
        trigger={(trigger) => (
          <TopbarButton id={trigger.id} label="Settings" title="Settings" active={(showActiveState && active) || menuOpen} onPress={trigger.toggle} onHover={(inside) => inside && preloadSettingsScreen()}>
            {(color) => (
              <>
                <GroupIcon icon={Icons.stella.Settings} size={15} strokeWidth={1.75} color={color} hoverColor={t.c.textStrong} />
                {connectHint.active ? <HintDot top={2} right={2} size={7} ring={t.c.surfaceBase} /> : null}
              </>
            )}
          </TopbarButton>
        )}
      >
        <SettingsMenuItems destinations={destinations} withPlan={false} />
      </DropdownMenu>
      {popovers}
    </row>
  );
}
