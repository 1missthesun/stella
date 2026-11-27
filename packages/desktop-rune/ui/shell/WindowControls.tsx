import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "@/shared/i18n";
import { Icons } from "../kit";
import { mixOklch, radius, useTokens, derive } from "../theme";
import { GroupIcon } from "./topbar/chrome";

const MAXIMIZE_STATE_SYNC_DELAY_MS = 50;

/** desktop-ui's `WindowControls` (`.shell-topbar-window-controls`, `.shell-topbar-wc-btn`). */
export function WindowControls({ useWindowsIcons }: { useWindowsIcons: boolean }) {
  const t = useT();
  const tk = useTokens();
  const [isMaximized, setIsMaximized] = useState(false);
  const look = derive(tk, "wc", (tk) => ({ hover: mixOklch(tk.c.foreground, 8, "transparent") }));

  const updateMaximizedState = useCallback(() => {
    const promise = window.electronAPI?.window.isMaximized?.();
    if (!promise) return;
    void promise.then((maximized) => setIsMaximized(Boolean(maximized)));
  }, []);

  useEffect(() => updateMaximizedState(), [updateMaximizedState]);

  const button = (id: string, label: string, onPress: () => void, glyph: ReactNode, close = false) => (
    <box
      id={id}
      role="button"
      label={label}
      title={label}
      titleSide="bottom"
      focusable
      noWindowDrag
      w={24}
      h={24}
      center
      radius={radius.xs}
      hover={close ? tk.c.destructive : look.hover}
      hoverGroup
      focusRing={{ width: 2, offset: 0, color: tk.c.ring }}
      motion={{ dur: 0.12 }}
      onPress={onPress}
    >
      {glyph}
    </box>
  );
  const color = tk.c.textBase;
  const strong = tk.c.textStrong;
  const maxIcon = useWindowsIcons ? (isMaximized ? Icons.window.WindowsRestoreIcon : Icons.window.WindowsMaximizeIcon) : isMaximized ? Icons.stella.Square : Icons.stella.Maximize2;

  return (
    <row id="shell-topbar-window-controls" h="full" align="center" gap={2} px={8} noWindowDrag>
      {button("wc-minimize", t("shell.windowControls.minimize"), () => window.electronAPI?.window.minimize?.(), <GroupIcon icon={Icons.stella.Minus} size={13} strokeWidth={1.8} color={color} hoverColor={strong} />)}
      {button(
        "wc-maximize",
        isMaximized ? t("shell.windowControls.restore") : t("shell.windowControls.maximize"),
        () => {
          window.electronAPI?.window.maximize?.();
          window.setTimeout(updateMaximizedState, MAXIMIZE_STATE_SYNC_DELAY_MS);
        },
        <GroupIcon icon={maxIcon} size={useWindowsIcons ? 11 : isMaximized ? 11 : 12} strokeWidth={useWindowsIcons ? undefined : 1.8} color={color} hoverColor={strong} />,
      )}
      {button("wc-close", t("common.close"), () => window.electronAPI?.window.close?.(), <GroupIcon icon={Icons.stella.X} size={13} strokeWidth={1.8} color={color} hoverColor={tk.c.primaryForeground} />, true)}
    </row>
  );
}
