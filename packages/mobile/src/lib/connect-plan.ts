import { useEffect, useRef, useSyncExternalStore } from "react";
import { CONNECT_PLAN_OFFER_MOBILE_ENABLED } from "@stella/contracts/connect-plan-offer";
import type { ChatMessage } from "../types";
import { openDrawer, useDrawerOpen } from "./drawer";

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
  openDrawer();
}

export function openChatSettingsAt(brainId: string): void {
  brainRequest = brainId;
  openDrawer();
}

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
