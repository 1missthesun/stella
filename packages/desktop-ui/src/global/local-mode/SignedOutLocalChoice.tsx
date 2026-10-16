import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import {
  clearLocalChatSync,
  markLocalChatSync,
  pendingLocalChatSync,
  settleSignedOutLocalMode,
  useSignedOutLocalMode,
} from "@/features/chat/services/chat-storage-preference";
import { importLocalPiChat } from "@/features/chat/pi/pi-chat-store";
import { useMemorySyncStatus } from "@/features/cloud/use-memory-sync-status";
import "./local-mode.css";

/**
 * After signing in, chats and memory made without an account stay on this
 * computer until the user says otherwise: keep them here, or copy them into
 * the account. Nothing is uploaded before that choice.
 */
export function SignedOutLocalChoice({
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
  const [localId, setLocalId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const memorySync = useMemorySyncStatus();
  const hasMemorySync = Boolean(window.electronAPI?.memorySync);
  // Memory files the account doesn't have yet; unknown until the sync service has looked.
  const waitingMemory = !hasMemorySync
    ? 0
    : memorySync?.phase === "held" && memorySync.heldReason === "local_choice"
      ? (memorySync.waitingFiles ?? 0)
      : null;

  useEffect(() => {
    if (!signedIn || !signedOutLocal) {
      setOpen(false);
      return;
    }
    const localChat = window.electronAPI?.localChat;
    if (!localChat || waitingMemory === null) return;
    let canceled = false;
    void (async () => {
      const id = await localChat.getOrCreateDefaultConversationId();
      const window_ = await localChat.listMessages({ conversationId: id, maxVisibleMessages: 1 });
      if (canceled) return;
      const chatEmpty = window_.visibleMessageCount === 0 && window_.messages.length === 0;
      if (chatEmpty && waitingMemory === 0) {
        await settleSignedOutLocalMode("cloud");
        return;
      }
      setLocalId(chatEmpty ? null : id);
      setOpen(true);
    })().catch((error: unknown) => console.warn("[local-mode] Couldn't read the local chat.", error));
    return () => {
      canceled = true;
    };
  }, [signedIn, signedOutLocal, waitingMemory]);

  const choose = useCallback(
    async (mode: "cloud" | "local") => {
      setBusy(true);
      try {
        if (mode === "cloud" && localId) markLocalChatSync(localId);
        await settleSignedOutLocalMode(mode);
        setOpen(false);
      } catch (error) {
        console.warn("[local-mode] Couldn't save the chat storage choice.", error);
        clearLocalChatSync();
        showToast({ title: t("global.localMode.choiceFailed"), variant: "error" });
      } finally {
        setBusy(false);
      }
    },
    [localId, t],
  );

  const importing = useRef<string | null>(null);
  const runImport = useCallback(
    (target: string) => {
      const from = pendingLocalChatSync();
      if (!from || importing.current === target) return;
      importing.current = target;
      void importLocalPiChat(target, from)
        .then(() => {
          clearLocalChatSync();
          showToast({ title: t("global.localMode.synced"), variant: "success" });
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

  if (!open) return null;
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && setOpen(false)}>
      <DialogContent fit className="local-mode-choice">
        <DialogHeader>
          <DialogTitle>{t("global.localMode.choiceTitle")}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody className="local-mode-choice-body">
          <DialogDescription className="local-mode-choice-text">
            {t("global.localMode.choiceBody")}
          </DialogDescription>
          <div className="local-mode-choice-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="pill-btn pill-btn--lg"
              data-local-choice="keep"
              onClick={() => void choose("local")}
            >
              {t("global.localMode.keep")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              className="pill-btn pill-btn--primary pill-btn--lg"
              data-local-choice="sync"
              onClick={() => void choose("cloud")}
            >
              {t("global.localMode.sync")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
