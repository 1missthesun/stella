import { memo } from "react";
import { CatchUpPill } from "@/features/catch-up/CatchUpPill";
import { AssistantReplyPeek, type AssistantReplyPeekProps } from "./AssistantReplyPeek";

export const ComposerLeadRow = memo(function ComposerLeadRow({
  replyPeek,
  catchUpConversationId,
  maxW = 800,
}: {
  replyPeek?: AssistantReplyPeekProps | null;
  catchUpConversationId?: string | null;
  maxW?: number;
}) {
  return (
    <box w="full" maxW={maxW}>
      {replyPeek ? <AssistantReplyPeek {...replyPeek} /> : null}
      <row w="full" align="center" gap={6} pl={12}>
        {catchUpConversationId ? <CatchUpPill conversationId={catchUpConversationId} /> : null}
      </row>
    </box>
  );
});
