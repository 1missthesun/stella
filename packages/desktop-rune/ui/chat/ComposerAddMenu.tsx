import { memo, useCallback, useId, useState, type Dispatch, type SetStateAction } from "react";
import { toggleShowStella, useShowStellaStatus } from "@/features/show-stella/use-show-stella";
import { getElectronApi } from "@/platform/electron/electron";
import type { ChatContext } from "@/shared/types/electron";
import { useT } from "@/shared/i18n";
import { DropdownMenu, Icons, MenuItem, withStroke } from "../kit";
import { useTokens } from "../theme";
import { ComposerAddButton } from "./ComposerPrimitives";
import { attachPathsToContext } from "./attach-paths";
import { rune } from "./engine";

type ComposerAddMenuProps = {
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>;
  title?: string;
  allowCapture?: boolean;
};

const formatShortcut = (accelerator: string): string => {
  const mac = getElectronApi()?.platform === "darwin";
  if (!mac) return accelerator.replace(/Control/g, "Ctrl");
  const symbols: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", CommandOrControl: "⌘" };
  const parts = accelerator.split("+");
  const order = ["Control", "Alt", "Shift", "Command", "CommandOrControl"];
  const mods = parts.filter((part) => part in symbols).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keys = parts.filter((part) => !(part in symbols));
  return `${mods.map((part) => symbols[part]).join("")}${keys.join("")}`;
};

export const ComposerAddMenu = memo(function ComposerAddMenu({ setChatContext, title, allowCapture = true }: ComposerAddMenuProps) {
  const t = useT();
  const tokens = useTokens();
  const id = `composer-add:${useId()}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const recordScreen = useShowStellaStatus();

  const attachFiles = useCallback(async () => {
    const paths = await rune().dialog.openFile({ multi: true });
    if (!paths || paths.length === 0) return;
    await attachPathsToContext(paths, setChatContext);
  }, [setChatContext]);

  const capture = useCallback(async () => {
    const api = getElectronApi();
    if (!api) return;
    try {
      await api.capture.beginRegionCapture();
    } catch (error) {
      console.warn("[composer-add-menu] capture failed:", error);
    }
  }, []);

  return (
    <DropdownMenu
      id={id}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      side="top"
      align="start"
      sideOffset={6}
      minW={220}
      maxW={280}
      trigger={(trigger) => <ComposerAddButton id={trigger.id} title={title ?? t("app.chat.addMenu.add")} onPress={trigger.toggle} />}
    >
      <MenuItem icon={withStroke(Icons.stella.Paperclip, 1.75)} onSelect={() => void attachFiles()}>
        {t("app.chat.addMenu.attachFiles")}
      </MenuItem>
      {allowCapture ? (
        <MenuItem icon={withStroke(Icons.stella.Camera, 1.75)} onSelect={() => void capture()}>
          {t("app.chat.addMenu.capture")}
        </MenuItem>
      ) : null}
      {allowCapture && recordScreen?.available ? (
        <MenuItem
          icon={withStroke(Icons.stella.Record, 1.75)}
          onSelect={() => void toggleShowStella()}
          trailing={
            recordScreen.shortcut ? (
              <text pl={16} size={12} tracking={12 * 0.04} color={tokens.c.textWeak} shrink={false}>
                {formatShortcut(recordScreen.shortcut)}
              </text>
            ) : undefined
          }
        >
          {t("app.chat.addMenu.showStella")}
        </MenuItem>
      ) : null}
    </DropdownMenu>
  );
});
