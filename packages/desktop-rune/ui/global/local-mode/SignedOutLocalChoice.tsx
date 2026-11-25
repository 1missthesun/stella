import { Button, Dialog, DialogBody, DialogCloseButton, DialogContent, DialogDescription, DialogHeader, DialogTitle, Press, showToast } from "../../kit/compat";
import { useLocalMode } from "./local-mode.styles";
import { usePill } from "../shared/pill.styles";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT, useTPlural } from "@/shared/i18n";
import {
  clearLocalChatSync,
  createPrivateConversation,
  markLocalChatSync,
  pendingLocalChatSync,
  settleSignedOutLocalMode,
  useSignedOutLocalMode,
} from "@/features/chat/services/chat-storage-preference";
import { importLocalPiChat } from "@/features/chat/pi/pi-chat-store";
import { useMemorySyncStatus } from "@/features/cloud/use-memory-sync-status";

export function SignedOutLocalChoice({
  signedIn,
  isPrivate,
  conversationId,
}: {
  signedIn: boolean;
  isPrivate: boolean;
  conversationId: string | null;
}) {
  const s = useLocalMode();
  const t = useT();
  const signedOutLocal = useSignedOutLocalMode();
  const [localId, setLocalId] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const tPlural = useTPlural();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const memorySync = useMemorySyncStatus();
  const hasMemorySync = Boolean(window.electronAPI?.memorySync);
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
      setMessageCount(window_.visibleMessageCount);
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
        .then(createPrivateConversation)
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
  const notes = waitingMemory ?? 0;
  const messages = tPlural("global.localMode.messages", messageCount);
  const notesText = tPlural("global.localMode.notes", notes);
  const choiceBody =
    localId && notes > 0
      ? t("global.localMode.choiceBodyBoth", { messages, notes: notesText })
      : localId
        ? t("global.localMode.choiceBodyChat", { messages })
        : t("global.localMode.choiceBodyMemory", { notes: notesText });
  return (
    <Dialog open onOpenChange={(next) => !next && !busy && setOpen(false)}>
      <DialogContent fit {...s.localModeChoice}>
        <DialogHeader>
          <DialogTitle>{t("global.localMode.choiceTitle")}</DialogTitle>
          <DialogCloseButton aria-label={t("common.close")} />
        </DialogHeader>
        <DialogBody {...s.localModeChoiceBody}>
          <DialogDescription {...s.localModeChoice_localModeChoiceText}>
            {choiceBody}
          </DialogDescription>
          <row {...s.localModeChoiceActions} {...s.localModeChoiceActionsSplit}>
            <Press {...s.localModeChoiceKeep} disabled={busy} onPress={() => void choose("local")}>
              {t("global.localMode.keep")}
            </Press>
            <Button variant="primary" disabled={busy} className="pill-btn pill-btn--primary pill-btn--lg" data-local-choice="sync" onClick={() => void choose("cloud")}>
              {t("global.localMode.sync")}
            </Button>
          </row>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
