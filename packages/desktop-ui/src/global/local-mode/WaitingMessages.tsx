import { useT } from "@/shared/i18n";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import {
  removeWaitingMessage,
  useWaitingMessages,
} from "@/features/cloud/paused-account";
import "./local-mode.css";

/** Messages written while the account was signed out; they send once it signs back in. */
export function WaitingMessages() {
  const t = useT();
  const { accountScope, isCloudConversationReady } = useCloudConversationSession();
  const waiting = useWaitingMessages(accountScope);
  if (!waiting.length) return null;
  return (
    <div className="waiting-messages" data-testid="waiting-messages">
      {waiting.map((message) => (
        <div key={message.id} className="waiting-message">
          {message.text}
        </div>
      ))}
      <div className="waiting-messages__note">
        <span>
          {isCloudConversationReady
            ? t("global.sessionPaused.sending")
            : t("global.sessionPaused.waiting")}
        </span>
        {isCloudConversationReady ? null : (
          <button
            type="button"
            className="waiting-messages__remove"
            onClick={() => {
              for (const message of waiting) removeWaitingMessage(accountScope, message.id);
            }}
          >
            {t("global.sessionPaused.dontSend")}
          </button>
        )}
      </div>
    </div>
  );
}
