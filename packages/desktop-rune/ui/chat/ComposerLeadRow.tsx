import { memo } from "react";
import { CatchUpPill } from "@/features/catch-up/CatchUpPill";
import { AssistantReplyPeek, type AssistantReplyPeekProps } from "./AssistantReplyPeek";

export const ComposerLeadRow = memo(function ComposerLeadRow({ replyPeek, catchUpConversationId }: { replyPeek?: AssistantReplyPeekProps | null; catchUpConversationId?: string | null }) {
  return (
    <box w="full" maxW={800}>
      {replyPeek ? <AssistantReplyPeek {...replyPeek} /> : null}
      <row w="full" align="center" gap={6} pl={12}>
        {catchUpConversationId ? <CatchUpPill conversationId={catchUpConversationId} /> : null}
      </row>
    </box>
  );
});
