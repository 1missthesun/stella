import { memo } from "react";
import {
  AssistantReplyPeek,
  type AssistantReplyPeekProps,
} from "@/app/chat/AssistantReplyPeek";
import { CatchUpPill } from "@/features/catch-up/CatchUpPill";

type ComposerLeadRowProps = {
  replyPeek?: AssistantReplyPeekProps | null;
  catchUpConversationId?: string | null;
};

export const ComposerLeadRow = memo(function ComposerLeadRow({
  replyPeek,
  catchUpConversationId,
}: ComposerLeadRowProps) {
  return (
    <div className="composer-context-peek-anchor">
      {replyPeek ? <AssistantReplyPeek {...replyPeek} /> : null}
      <div className="composer-context-lead-row">
        {catchUpConversationId ? (
          <CatchUpPill conversationId={catchUpConversationId} />
        ) : null}
      </div>
    </div>
  );
});
