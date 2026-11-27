import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toggleManualReadAloud, useManualReadAloudStatus } from "@/features/voice/services/read-aloud/manual-read-aloud";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { useT } from "@/shared/i18n";
import { DropdownMenu, Icons, MenuItem, MenuLabel, withStroke, type IconData } from "../kit";
import { derive, mix, useTokens } from "../theme";

const COPIED_RESET_MS = 1600;
const COPIED_MENU_CLOSE_MS = 700;
const STACK_ROW_MAX_H = 49;

type CopyAttachment = { path?: string; url?: string; mimeType?: string; kind?: string; name?: string };

type MessageActionsProps = {
  text: string;
  messageKey: string;
  showReadAloud?: boolean;
  align?: "start" | "end";
  timestampMs?: number;
  copyAttachment?: CopyAttachment;
  onReply?: (text: string) => void;
};

function ActionButton({ id, label, title, pinned, onPress, icon, size, color }: { id?: string; label: string; title?: string; pinned?: boolean; onPress?: () => void; icon: IconData; size: number; color?: string }) {
  const t = useTokens();
  const hover = derive(t, "message-action-hover", (k) => mix(k.c.foreground, 6, "transparent"));
  return (
    <box hoverOpacity={pinned ? undefined : [0, 1]} opacity={pinned ? 1 : undefined} motion={{ dur: 0.12, bounce: 0 }}>
      <box
        id={id}
        role="button"
        label={label}
        title={title ?? label}
        focusable
        focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 7 }}
        w={24}
        h={24}
        center
        radius={7}
        hoverFill={hover}
        hoverGroup
        motion={{ dur: 0.12, bounce: 0 }}
        onPress={onPress}
      >
        <icon svg={withStroke(icon, 2).body} name={`${icon.name}@2`} view={icon.view} size={size} color={color ?? t.c.textWeak} hoverColor={color ?? t.c.textStrong} />
      </box>
    </box>
  );
}

/** desktop-ui's `MessageActions`: reply and copy (user), or a ⋮ menu with the time, copy and read aloud (assistant), shown on row hover. */
export const MessageActions = memo(function MessageActions({ text, messageKey, showReadAloud = false, align = "start", timestampMs, copyAttachment, onReply }: MessageActionsProps) {
  const t = useT();
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [railH, setRailH] = useState(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readAloudStatus = useManualReadAloudStatus(messageKey);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next && closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const copy = useCallback(async (): Promise<boolean> => {
    const value = text.trim();
    let ok = false;
    if (value) ok = await copyTextToClipboard(value);
    else if (copyAttachment) ok = Boolean((await window.electronAPI?.media?.copyAttachment?.(copyAttachment))?.ok);
    else return false;
    if (!ok) {
      console.warn("[message-actions] copy failed");
      return false;
    }
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return true;
  }, [text, copyAttachment]);
  const handleCopySelect = useCallback(async () => {
    if (!(await copy())) {
      setOpen(false);
      return;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, COPIED_MENU_CLOSE_MS);
  }, [copy]);

  const isPlaying = readAloudStatus !== "idle";
  const hasCopyable = Boolean(text.trim() || copyAttachment);
  const timestampLabel = typeof timestampMs === "number" && Number.isFinite(timestampMs) ? new Date(timestampMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const canReply = Boolean(onReply && text.trim());
  const inlineCopy = !showReadAloud;
  const copyLabel = copied ? t("app.chat.messageActions.copied") : t("app.chat.messageActions.copy");
  const asRow = railH > 0 && railH <= STACK_ROW_MAX_H;
  const direction = asRow ? (align === "end" ? "row-reverse" : "row") : "col";
  const buttons = [
    canReply ? (
      <ActionButton key="reply" label={t("app.chat.messageActions.reply")} onPress={() => onReply?.(text)} icon={Icons.stella.Reply} size={15} />
    ) : null,
    inlineCopy ? (
      hasCopyable ? (
        <ActionButton key="copy" label={copyLabel} title={timestampLabel ? `${copyLabel} · ${timestampLabel}` : copyLabel} pinned={copied} onPress={() => void copy()} icon={copied ? Icons.stella.Check : Icons.stella.Copy} size={15} />
      ) : null
    ) : (
      <DropdownMenu
        key="more"
        id={`message-actions:${messageKey}`}
        open={open}
        onOpenChange={handleOpenChange}
        align={align === "end" ? "end" : "start"}
        sideOffset={6}
        trigger={(trigger) => (
          <ActionButton id={trigger.id} label={t("app.chat.messageActions.more")} pinned={open || isPlaying} onPress={trigger.toggle} icon={Icons.stella.MoreVertical} size={16} color={isPlaying ? tokens.c.primary : undefined} />
        )}
      >
        {timestampLabel ? <MenuLabel>{timestampLabel}</MenuLabel> : null}
        {hasCopyable ? (
          <MenuItem icon={copied ? Icons.stella.Check : Icons.stella.Copy} keepOpen onSelect={() => void handleCopySelect()}>
            {copyLabel}
          </MenuItem>
        ) : null}
        {showReadAloud ? (
          <MenuItem icon={readAloudStatus === "loading" ? Icons.stella.LoaderCircle : readAloudStatus === "playing" ? Icons.stella.Square : Icons.stella.Volume2} onSelect={() => void toggleManualReadAloud(messageKey, text)}>
            {isPlaying ? t("app.chat.messageActions.stopReading") : t("app.chat.messageActions.readAloud")}
          </MenuItem>
        ) : null}
      </DropdownMenu>
    ),
  ];
  return (
    <col w={24} selfAlign="stretch" shrink={false} onLayout={(r) => setRailH(r.h)}>
      {direction === "col" ? (
        <col absolute={align === "end" ? { right: 0, bottom: 0 } : { left: 0, bottom: 0 }} gap={2} align="center" raise={1}>
          {buttons}
        </col>
      ) : (
        <row absolute={align === "end" ? { right: 0, bottom: 0 } : { left: 0, bottom: 0 }} gap={2} align="center" dir={direction === "row-reverse" ? "rtl" : "ltr"} raise={1}>
          {buttons}
        </row>
      )}
    </col>
  );
});
