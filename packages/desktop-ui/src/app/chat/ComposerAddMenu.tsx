import { memo, useCallback, useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { Camera, Paperclip, Record } from "@/ui/icons";
import { toggleShowStella, useShowStellaStatus } from "@/features/show-stella/use-show-stella";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { ComposerAddButton } from "@/features/chat/ComposerPrimitives";
import { getElectronApi } from "@/platform/electron/electron";
import { attachFilesToContext } from "@/features/chat/lib/file-attach";
import type { ChatContext } from "@/shared/types/electron";
import { useT } from "@/shared/i18n";
import "./composer-add-menu.css";

type ComposerAddMenuProps = {
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>;
  className?: string;
  title?: string;
  /** Screenshots and recordings land in the main window's composer, so surfaces with their own attachments turn them off. */
  allowCapture?: boolean;
};

export const ComposerAddMenu = memo(function ComposerAddMenu({
  setChatContext,
  className,
  title,
  allowCapture = true,
}: ComposerAddMenuProps) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const recordScreen = useShowStellaStatus();

  const handleAttachFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      if (!list || list.length === 0) {
        event.target.value = "";
        return;
      }
      await attachFilesToContext(Array.from(list), setChatContext);
      event.target.value = "";
    },
    [setChatContext],
  );

  const handleCapture = useCallback(async () => {
    const api = getElectronApi();
    if (!api) return;
    try {
      await api.capture.beginRegionCapture();
    } catch (error) {
      console.warn("[composer-add-menu] capture failed:", error);
    }
  }, []);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <ComposerAddButton
            className={className}
            title={title ?? t("app.chat.addMenu.add")}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={6}
          className="composer-add-menu"
        >
          <DropdownMenuItem onSelect={handleAttachFiles}>
            <span data-slot="dropdown-menu-item-icon">
              <Paperclip size={16} strokeWidth={1.75} />
            </span>
            {t("app.chat.addMenu.attachFiles")}
          </DropdownMenuItem>
          {allowCapture ? (
            <DropdownMenuItem onSelect={handleCapture}>
              <span data-slot="dropdown-menu-item-icon">
                <Camera size={16} strokeWidth={1.75} />
              </span>
              {t("app.chat.addMenu.capture")}
            </DropdownMenuItem>
          ) : null}
          {allowCapture && recordScreen?.available ? (
            <DropdownMenuItem
              title={t("features.showStella.tagline")}
              onSelect={() => void toggleShowStella()}
            >
              <span data-slot="dropdown-menu-item-icon">
                <Record size={16} strokeWidth={1.75} />
              </span>
              {t("app.chat.addMenu.showStella")}
              {recordScreen.shortcut ? (
                <span className="composer-add-menu__shortcut">
                  {formatShortcut(recordScreen.shortcut)}
                </span>
              ) : null}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="composer-add-menu__file-input"
        onChange={handleFilesSelected}
      />
    </>
  );
});

const formatShortcut = (accelerator: string): string => {
  const mac = getElectronApi()?.platform === "darwin";
  if (!mac) return accelerator.replace(/Control/g, "Ctrl");
  const symbols: Record<string, string> = {
    Control: "⌃",
    Alt: "⌥",
    Shift: "⇧",
    Command: "⌘",
    CommandOrControl: "⌘",
  };
  const parts = accelerator.split("+");
  const order = ["Control", "Alt", "Shift", "Command", "CommandOrControl"];
  const mods = parts.filter((part) => part in symbols).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keys = parts.filter((part) => !(part in symbols));
  return `${mods.map((part) => symbols[part]).join("")}${keys.join("")}`;
};
