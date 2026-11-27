import { memo, useMemo } from "react";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import { useT } from "@/shared/i18n";
import { closeConversationFocus, useConversationFocus } from "@/features/chat/services/conversation-focus-store";
import { useLineageMessages } from "@/features/chat/services/lineage-messages-store";
import { useThreadActivityRecords } from "@/features/chat/hooks/use-thread-activity-records";
import { getDisplayMessageText, getDisplayUserText } from "@/features/chat/lib/message-turn-display";
import { toReplyPreview } from "@stella/contracts/reply-refs";
import { useAgentTitle } from "@/features/cloud/use-agent-title";
import { EmptyState, Icon, Icons, withStroke } from "../kit";
import { mix, useTokens } from "../theme";
import { useChatScrollManagement } from "./use-chat-scroll-management";
import type { LegendContentStyle } from "./ChatTimeline";

const FOCUS_CONTENT_STYLE: LegendContentStyle = { paddingTop: 16, paddingBottom: 16, paddingLeft: 24, paddingRight: 24 };
const PANEL_MAX_W = 800;
const CLOSE_SIZE = 40;
const ESCAPE = ["Escape"];

type FocusRoot = NonNullable<ReturnType<typeof useConversationFocus>>["root"];

const rootKey = (root: FocusRoot) => `${root.kind}:${root.kind === "message" ? root.id : root.threadId}`;

/** desktop-ui's `ConversationFocusOverlay`: one message's or agent's lineage over the chat, closed by the round button or Escape. */
export const ConversationFocusOverlay = memo(function ConversationFocusOverlay({ conversationId }: { conversationId: string | null | undefined }) {
  const focus = useConversationFocus(conversationId);
  if (!focus || !conversationId) return null;
  return <FocusPanel key={rootKey(focus.root)} conversationId={conversationId} root={focus.root} title={focus.title} />;
});

function FocusPanel({ conversationId, root, title }: { conversationId: string; root: FocusRoot; title?: string }) {
  const t = useT();
  const c = useTokens().c;
  const lineage = useLineageMessages(conversationId, root);
  const agentThreadIds = useMemo(() => (root.kind === "agent" ? [root.threadId] : []), [root]);
  const activity = useThreadActivityRecords(conversationId, agentThreadIds);
  const agentTitle = useAgentTitle(conversationId, root.kind === "agent" ? root.threadId : "", root.kind === "agent" ? [activity.get(root.threadId)?.description, title] : []);

  const scroll = useChatScrollManagement({
    hasOlderEvents: lineage.hasOlder,
    isLoadingOlder: lineage.isLoadingOlder,
    onLoadOlder: lineage.loadOlder,
    paginationKey: `${conversationId}:${rootKey(root)}`,
    surface: "compact",
  });

  const heading = useMemo(() => {
    if (root.kind === "agent") return agentTitle || t("app.chat.focus.agentFallback");
    const rootMessage = lineage.messages.find((message) => message._id === root.id);
    if (rootMessage) {
      const preview = toReplyPreview(rootMessage.type === "user_message" ? getDisplayUserText(rootMessage) : getDisplayMessageText(rootMessage));
      if (preview) return preview;
    }
    return title?.trim() || t("app.chat.focus.messageFallback");
  }, [agentTitle, lineage.messages, root, t, title]);

  return (
    <row
      id="conversation-focus"
      absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
      raise={40}
      justify="center"
      align="stretch"
      fill={mix(c.background, 62, "transparent")}
      backdropBlur={6}
      enter={{ opacity: 0, dur: 0.16, bounce: 0 }}
      keys={ESCAPE}
      onKey={closeConversationFocus}
    >
      <col role="group" label={t("app.chat.focus.ariaLabel", { title: heading })} w="full" maxW={PANEL_MAX_W} minH={0} align="stretch">
        <col grow={1} minH={0} align="stretch">
          {lineage.error ? (
            <col grow={1} minH={0} center>
              <EmptyState motif="unavailable" title={t("app.chat.focus.errorTitle")} body={t("app.chat.focus.errorBody")} />
            </col>
          ) : (
            <ConversationEvents
              messages={lineage.messages}
              conversationId={conversationId}
              hasOlderMessages={lineage.hasOlder}
              isLoadingOlder={lineage.isLoadingOlder}
              isLoadingHistory={!lineage.hasLoaded}
              list={scroll.list}
              className="conversation-focus__list"
              contentContainerStyle={FOCUS_CONTENT_STYLE}
              estimatedItemSize={140}
              alignItemsAtEnd
            />
          )}
        </col>
        <row justify="center" pt={8} px={24} pb={12} shrink={false}>
          <box
            role="button"
            label={t("app.chat.focus.close")}
            title={t("app.chat.focus.closeHint")}
            focusable
            autoFocus
            cursor="pointer"
            w={CLOSE_SIZE}
            h={CLOSE_SIZE}
            center
            radius={CLOSE_SIZE / 2}
            border={c.border}
            fill={c.background}
            hoverFill={c.border}
            hoverColor={c.foreground}
            focusRing={{ width: 2, offset: 1, color: c.ring }}
            onPress={closeConversationFocus}
          >
            <Icon icon={withStroke(Icons.stella.X, 2)} size={16} color={c.mutedForeground} />
          </box>
        </row>
      </col>
    </row>
  );
}
