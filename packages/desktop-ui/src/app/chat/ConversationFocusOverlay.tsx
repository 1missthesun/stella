import { memo, useMemo, useRef } from "react";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import { X } from "@/ui/icons";
import { Modal } from "@/ui/modal";
import { useT } from "@/shared/i18n";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { useChatScrollManagement } from "@/shell/use-chat-scroll-management";
import {
  closeConversationFocus,
  useConversationFocus,
} from "@/features/chat/services/conversation-focus-store";
import { useLineageMessages } from "@/features/chat/services/lineage-messages-store";
import { useThreadActivityRecords } from "@/features/chat/hooks/use-thread-activity-records";
import {
  getDisplayMessageText,
  getDisplayUserText,
} from "@/features/chat/lib/message-turn-display";
import { toReplyPreview } from "@stella/contracts/reply-refs";
import { useAgentTitle } from "@/features/cloud/use-agent-title";
import type { LegendContentStyle } from "./ChatTimeline";
import "./conversation-focus-overlay.css";

const FOCUS_CONTENT_STYLE: LegendContentStyle = {
  paddingTop: 16,
  paddingBottom: 16,
  paddingLeft: 24,
  paddingRight: 24,
};

type ConversationFocusOverlayProps = {
  conversationId: string | null | undefined;
};

export const ConversationFocusOverlay = memo(function ConversationFocusOverlay({
  conversationId,
}: ConversationFocusOverlayProps) {
  const focus = useConversationFocus(conversationId);
  if (!focus || !conversationId) return null;
  return (
    <FocusPanel
      key={`${focus.root.kind}:${
        focus.root.kind === "message" ? focus.root.id : focus.root.threadId
      }`}
      conversationId={conversationId}
      root={focus.root}
      title={focus.title}
    />
  );
});

function FocusPanel({
  conversationId,
  root,
  title,
}: {
  conversationId: string;
  root: NonNullable<ReturnType<typeof useConversationFocus>>["root"];
  title?: string;
}) {
  const t = useT();
  const lineage = useLineageMessages(conversationId, root);
  const agentThreadIds = useMemo(
    () => (root.kind === "agent" ? [root.threadId] : []),
    [root],
  );
  const activity = useThreadActivityRecords(conversationId, agentThreadIds);
  const agentTitle = useAgentTitle(
    conversationId,
    root.kind === "agent" ? root.threadId : "",
    root.kind === "agent" ? [activity.get(root.threadId)?.description, title] : [],
  );
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const scroll = useChatScrollManagement({
    hasOlderEvents: lineage.hasOlder,
    isLoadingOlder: lineage.isLoadingOlder,
    onLoadOlder: lineage.loadOlder,
    paginationKey: `${conversationId}:${root.kind}:${
      root.kind === "message" ? root.id : root.threadId
    }`,
    surface: "compact",
  });

  const heading = useMemo(() => {
    if (root.kind === "agent") {
      return agentTitle || t("app.chat.focus.agentFallback");
    }
    const rootMessage = lineage.messages.find(
      (message) => message._id === root.id,
    );
    if (rootMessage) {
      const text =
        rootMessage.type === "user_message"
          ? getDisplayUserText(rootMessage)
          : getDisplayMessageText(rootMessage);
      const preview = toReplyPreview(text);
      if (preview) return preview;
    }
    return title?.trim() || t("app.chat.focus.messageFallback");
  }, [agentTitle, lineage.messages, root, t, title]);

  return (
    <Modal
      onClose={closeConversationFocus}
      modal={false}
      label={t("app.chat.focus.ariaLabel", { title: heading })}
      backdropClassName="conversation-focus"
      backdropProps={{
        "data-testid": "conversation-focus",
        "data-focus-kind": root.kind,
      }}
      className="conversation-focus__panel"
      initialFocusRef={closeButtonRef}
    >
      <div className="conversation-focus__body">
        <div className="conversation-focus__surface">
          {lineage.error ? (
            <EmptyState
              motif="unavailable"
              title={t("app.chat.focus.errorTitle")}
              body={t("app.chat.focus.errorBody")}
            />
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
        </div>
      </div>
      <footer className="conversation-focus__footer">
        <button
          ref={closeButtonRef}
          type="button"
          className="conversation-focus__close"
          onClick={closeConversationFocus}
          aria-label={t("app.chat.focus.close")}
          title={t("app.chat.focus.closeHint")}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </footer>
    </Modal>
  );
}
