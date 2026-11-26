import { useLayoutEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { isUserMessageOverflowing, shouldShowUserMessageToggle } from "@/app/chat/user-message-clamp";
import { derive, fontSize, mix, radius, useTokens } from "../theme";
import { modelMentionRuns } from "./ModelMentionText";
import { BUBBLE_FEATURES, useChatSurfaceLook } from "./chat-text";

const CLAMP_LINES = 4;

/** desktop-ui's `UserMessageBody`: the user's text clamped to four lines, with Show more / Show less when it overflows. */
export function UserMessageBody({ text }: { text: string }) {
  const t = useT();
  const tokens = useTokens();
  const c = derive(tokens, "user-body", (k) => ({
    mention: { color: k.c.chatUserBubbleText, bg: mix(k.c.chatUserBubbleText, 18, "transparent") },
    toggle: mix(k.c.chatUserBubbleText, 68, "transparent"),
    toggleHover: mix(k.c.chatUserBubbleText, 10, "transparent"),
  }));
  const [expanded, setExpanded] = useState(false);
  const [clampedH, setClampedH] = useState(0);
  const [fullH, setFullH] = useState(0);
  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);
  const overflowing = !expanded && isUserMessageOverflowing({ scrollHeight: fullH, clientHeight: clampedH });
  const [wasOverflowing, setWasOverflowing] = useState(false);
  if (!expanded && overflowing !== wasOverflowing && fullH > 0 && clampedH > 0) setWasOverflowing(overflowing);
  const showToggle = shouldShowUserMessageToggle({ overflowing: expanded ? wasOverflowing : overflowing, expanded });
  const runs = modelMentionRuns(text, c.mention);
  const look = { ...useChatSurfaceLook().text, color: tokens.c.chatUserBubbleText, features: BUBBLE_FEATURES };
  return (
    <col w="full" minW={0}>
      <col w="full" minW={0} align="stretch">
        <text {...look} spans={runs} selectable maxLines={expanded ? undefined : CLAMP_LINES} truncate={expanded ? undefined : "end"} onLayout={(r) => setClampedH(r.h)} />
        {expanded ? null : <text {...look} spans={runs} absolute={{ left: 0, top: 0, right: -1 }} hidden inert onLayout={(r) => setFullH(r.h)} />}
      </col>
      {showToggle ? (
        <box selfAlign="end" mt={6} py={2} radius={radius.sm} hoverFill={c.toggleHover} hoverGroup role="button" focusable label={expanded ? t("app.chat.userMessage.showLess") : t("app.chat.userMessage.showMore")} expanded={expanded} onPress={() => setExpanded((v) => !v)}>
          <text size={fontSize.sm} weight={500} lineHeight={fontSize.sm} color={c.toggle} hoverColor={tokens.c.chatUserBubbleText}>
            {expanded ? t("app.chat.userMessage.showLess") : t("app.chat.userMessage.showMore")}
          </text>
        </box>
      ) : null}
    </col>
  );
}
