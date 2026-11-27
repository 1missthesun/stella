import { useCallback, useEffect, useRef } from "react";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import {
  clearLocalChatSync,
  createPrivateConversation,
  markLocalChatSync,
  pendingLocalChatSync,
  settleSignedOutLocalMode,
  useSignedOutLocalMode,
} from "@/features/chat/services/chat-storage-preference";
import { importLocalPiChat } from "@/features/chat/pi/pi-chat-store";
import { parseWelcomeMark } from "@stella/contracts/welcome-message";

/**
 * Signing in moves what was done here without an account into the account:
 * the local chat is added to the end of the account's chat and Memory starts
 * syncing. Nothing in the account is replaced.
 */
export function SignedOutLocalSync({
  signedIn,
  isPrivate,
  conversationId,
}: {
  signedIn: boolean;
  isPrivate: boolean;
  conversationId: string | null;
}) {
  const t = useT();
  const signedOutLocal = useSignedOutLocalMode();
  const settling = useRef(false);

  useEffect(() => {
    if (!signedIn || !signedOutLocal || settling.current) return;
    const localChat = window.electronAPI?.localChat;
    if (!localChat) return;
    settling.current = true;
    void (async () => {
      const id = await localChat.getOrCreateDefaultConversationId();
      const window_ = await localChat.listMessages({ conversationId: id, maxVisibleMessages: 2 });
      // Stella's welcome alone is nothing to move: the account's chat has its own.
      const chatEmpty = window_.messages.every((message) =>
        Boolean(parseWelcomeMark((message.payload?.metadata as { welcome?: unknown } | undefined)?.welcome)),
      );
      if (!chatEmpty) markLocalChatSync(id);
      await settleSignedOutLocalMode("cloud");
    })()
      .catch((error: unknown) => {
        clearLocalChatSync();
        console.warn("[local-mode] Couldn't move the local chat to the account.", error);
      })
      .finally(() => {
        settling.current = false;
      });
  }, [signedIn, signedOutLocal]);

  const importing = useRef<string | null>(null);
  const runImport = useCallback(
    (target: string) => {
      const from = pendingLocalChatSync();
      if (!from || importing.current === target) return;
      importing.current = target;
      void importLocalPiChat(target, from)
        .then(async (imported) => {
          await createPrivateConversation();
          clearLocalChatSync();
          if (imported > 0) showToast({ title: t("global.localMode.synced"), variant: "success" });
        })
        .catch((error: unknown) => {
          console.warn("[local-mode] Copying the local chat to the account failed.", error);
          importing.current = null;
          showToast({
            title: t("global.localMode.syncFailed"),
            variant: "error",
            action: { label: t("common.tryAgain"), onClick: () => runImport(target) },
          });
        });
    },
    [t],
  );

  useEffect(() => {
    if (!signedIn || isPrivate || !conversationId || conversationId.startsWith("local_")) return;
    runImport(conversationId);
  }, [conversationId, isPrivate, runImport, signedIn]);

  return null;
}
