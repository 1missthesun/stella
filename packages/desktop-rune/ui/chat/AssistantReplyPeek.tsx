import { useT } from "@/shared/i18n";
import { Icon, Icons } from "../kit";
import { APP_TRACKING } from "../kit/compat";
import { derive, fontSize, mixOklch, radius, useTokens } from "../theme";
import { panelSurface } from "./surfaces";

export type AssistantReplyPeekProps = { text: string; onJumpToBottom: () => void; onDismiss: () => void };

export function AssistantReplyPeek({ text, onJumpToBottom, onDismiss }: AssistantReplyPeekProps) {
  const t = useT();
  const tokens = useTokens();
  const surface = panelSurface(tokens);
  const hover = derive(tokens, "assistant-reply-peek:hover", (k) => mixOklch(k.c.foreground, 6, "transparent"));
  return (
    <row
      absolute={{ left: 0, right: 0, bottom: 6 }}
      raise={30}
      role="status"
      align="stretch"
      radius={radius.xl}
      clip={radius.xl}
      fill={tokens.c.background}
      gradient={surface.gradient}
      border={surface.border}
      shadows={[...tokens.shadow.overlay, ...surface.shadows]}
      y={0}
      enter={{ opacity: 0, y: 4, dur: 0.16, bounce: 0 }}
    >
      <box role="button" focusable grow={1} minW={0} title={t("app.chat.replyPeek.jumpToLatest")} pt={8 + 1} pr={10} pb={8 + 1} pl={12 + 1} hoverFill={hover} align="center" focusRing={{ color: tokens.c.ring, width: 2, offset: -2 }} onPress={onJumpToBottom}>
        <text size={fontSize.base} lineHeight={fontSize.base * 1.25} tracking={APP_TRACKING} color={tokens.c.textBase} nowrap truncate>
          {text}
        </text>
      </box>
      <box role="button" focusable label={t("app.chat.replyPeek.dismiss")} shrink={false} w={32} center borderSides={[0, 0, 0, 1]} border={tokens.c.borderWeak} hoverFill={hover} hoverGroup focusRing={{ color: tokens.c.ring, width: 2, offset: -2 }} onPress={onDismiss}>
        <box hoverColor={tokens.c.textStrong}>
          <Icon icon={Icons.stella.X} size={14} color={tokens.c.textWeak} />
        </box>
      </box>
    </row>
  );
}
