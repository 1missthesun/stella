import { Press, T, tx } from "../../kit/compat";
import { useLocalMode } from "./local-mode.styles";
import { useT } from "@/shared/i18n";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import {
  removeWaitingMessage,
  useWaitingMessages,
} from "@/features/cloud/paused-account";

export function WaitingMessages() {
  const s = useLocalMode();
  const t = useT();
  const { accountScope, isCloudConversationReady } = useCloudConversationSession();
  const waiting = useWaitingMessages(accountScope);
  if (!waiting.length) return null;
  return (
    <col {...s.waitingMessages}>
      {waiting.map((message) => (
        <T w="full" {...s.waitingMessage} key={message.id}>
          {message.text}
        </T>
      ))}
      <row {...s.waitingMessagesNote}>
        <T {...tx(s.waitingMessagesNote)}>
          {isCloudConversationReady
            ? t("global.sessionPaused.sending")
            : t("global.sessionPaused.waiting")}
        </T>
        {isCloudConversationReady ? null : (
          <Press text={tx(s.waitingMessagesNote)} {...s.waitingMessagesRemove} onPress={() => {
              for (const message of waiting) removeWaitingMessage(accountScope, message.id);
            }}>
            {t("global.sessionPaused.dontSend")}
          </Press>
        )}
      </row>
    </col>
  );
}
