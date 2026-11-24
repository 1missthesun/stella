import { dismissComposerNotice, presentComposerNotice } from "@/features/chat/composer-notice-store";
import { translateNow } from "@/shared/i18n/active-translator";

const heldNoticeId = (conversationId: string) => `claude-login-held:${conversationId}`;

export const presentClaudeLoginHeld = (conversationId: string, email: string | undefined): void => {
  presentComposerNotice(
    {
      id: heldNoticeId(conversationId),
      conversationId,
      kind: "sign-in",
      title: translateNow("claudeLogin.heldTitle"),
      description: translateNow("claudeLogin.heldDescription"),
      claudeSignIn: { ...(email ? { email } : {}), continues: true },
    },
    {
      title: translateNow("claudeLogin.heldTitle"),
      description: translateNow("claudeLogin.heldDescription"),
      variant: "error",
      duration: 10000,
    },
  );
};

export const dismissClaudeLoginHeld = (conversationId: string): void =>
  dismissComposerNotice(heldNoticeId(conversationId));
