import { useCallback } from "react";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { engine } from "../../../desktop-rune/ui/kit/engine";
import { phoneNav } from "./nav";

/** packages/mobile's startChatWith: back to the chat with `text` waiting in the composer. */
export function useStartChatWith(): (text: string) => void {
  const chat = useChatRuntime();
  const composer = chat.composer;
  return useCallback(
    (text: string) => {
      composer.setMessage(text);
      phoneNav.selectTab("chat");
      composer.requestFocus();
    },
    [composer],
  );
}

export type SheetAction = { id: string; label: string; enabled?: boolean };

/**
 * packages/mobile's ActionSheetIOS and Alert.alert: a title and a message over a few choices (one may
 * be destructive) and Cancel, as iOS's own sheet or alert. Resolves with the picked id, or null.
 */
export function phoneSheet(opts: { title?: string; message?: string; actions: SheetAction[]; destructive?: string; cancel: string; alert?: boolean }): Promise<string | null> {
  return engine.popupMenu(
    opts.actions.map((a) => ({ id: a.id, label: a.label, enabled: a.enabled })),
    { sheet: { title: opts.title, message: opts.message, destructive: opts.destructive, cancel: opts.cancel, alert: opts.alert } },
  );
}

/** Alert.alert with only an OK: a title and a message. */
export const phoneAlert = (title: string, message: string, ok: string): Promise<string | null> => phoneSheet({ title, message, actions: [], cancel: ok, alert: true });
