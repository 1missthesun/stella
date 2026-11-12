import { useEffect, useRef, useSyncExternalStore } from "react";
import { CONNECT_PLAN_OFFER_MOBILE_ENABLED } from "@stella/contracts/connect-plan-offer";
import type { ChatMessage } from "../types";
import { openDrawer, useDrawerOpen } from "./drawer";

/**
 * The phone's connect-your-plan flow for when a Free account's usage of
 * Stella's own models runs out. A Free account can only keep going in the
 * cloud on its ChatGPT plan (cloud Claude needs a paid plan), so the offer
 * opens the chat settings panel on ChatGPT. Once ChatGPT is connected the
 * chat switches to it and the message that didn't go through comes back
 * into the composer, one tap from sending. Off until the owner gives an explicit go-ahead
 * (`@stella/contracts/connect-plan-offer`).
 */
export const connectPlanOfferEnabled = (): boolean => CONNECT_PLAN_OFFER_MOBILE_ENABLED;

type Pending = { conversationId: string | null };

let pending: Pending | null = null;
let brainRequest: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function startConnectPlan(conversationId: string | null): void {
  pending = { conversationId };
  brainRequest = "chatgpt";
  emit();
  openDrawer("end");
}

/** Opens the chat settings panel on one provider's page, such as `provider:openrouter`. */
export function openChatSettingsAt(brainId: string): void {
  brainRequest = brainId;
  openDrawer("end");
}

/** The chat settings page the offer asked for, once. */
export function takeChatSettingsBrainRequest(): string | null {
  const request = brainRequest;
  brainRequest = null;
  return request;
}

const clearConnectPlan = () => {
  if (!pending) return;
  pending = null;
  emit();
};

type ModelSettingsLike = {
  engine: string;
  connectedProviders?: readonly string[];
  selectEngine: (engine: "chatgpt") => void;
  refresh: () => unknown;
};

const lastOwnText = (messages: readonly ChatMessage[]): string | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    return message.text.trim() ? message.text : null;
  }
  return null;
};

/**
 * In the chat screen: after the offer's Connect ChatGPT, switch this chat to
 * ChatGPT as soon as it's connected and put the kept message back in the
 * composer (unless the person already typed something new).
 */
export function useConnectPlanResend({
  conversationId,
  messages,
  setDraft,
  settings,
}: {
  conversationId: string | null;
  messages: readonly ChatMessage[];
  setDraft: (update: (previous: string) => string) => void;
  settings: ModelSettingsLike;
}): void {
  const current = useSyncExternalStore(subscribe, () => pending, () => null);
  const kept = useRef<string | null>(null);
  const waiting = current !== null && current.conversationId === conversationId;
  const drawerOpen = useDrawerOpen();
  const chatGptConnected = settings.connectedProviders?.includes("chatgpt") ?? false;
  const { engine, selectEngine, refresh } = settings;

  useEffect(() => {
    if (waiting && kept.current === null) kept.current = lastOwnText(messages);
  }, [messages, waiting]);

  // Leaving the settings panel: pick up a connection made there.
  useEffect(() => {
    if (waiting && !drawerOpen) void refresh();
  }, [drawerOpen, refresh, waiting]);

  useEffect(() => {
    if (!waiting) return;
    if (engine === "chatgpt") {
      const text = kept.current;
      kept.current = null;
      clearConnectPlan();
      if (text) setDraft((previous) => (previous.trim() ? previous : text));
      return;
    }
    if (chatGptConnected) selectEngine("chatgpt");
  }, [chatGptConnected, engine, selectEngine, setDraft, waiting]);
}
