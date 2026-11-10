import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import { useChatMessages } from "@/context/use-chat-messages";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { uiState } from "@/platform/ui-state";
import { messageSoundPreferences, playMessageSound } from "./message-sound";

const SEEN_THROUGH_KEY_PREFIX = "stella.chatSeenThrough:";
const MIN_SOUND_GAP_MS = 1_500;
const SAME_REPLY_WINDOW_MS = 120_000;

type Reply = { id: string; at: number; fingerprint: string };

type ChatSummary = { replies: Reply[]; lastOwnAt: number };

const visibleText = (message: MessageRecord): string => {
  const text = (message.payload as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text.trim() : "";
};

const summarize = (messages: readonly MessageRecord[]): ChatSummary => {
  const replies: Reply[] = [];
  let lastOwnAt = 0;
  for (const message of messages) {
    if (message.type !== "assistant_message" && message.type !== "user_message") continue;
    if (isUiHiddenChatMessagePayload(message.payload ?? null)) continue;
    const text = visibleText(message);
    if (!text) continue;
    if (message.type === "user_message") {
      lastOwnAt = Math.max(lastOwnAt, message.timestamp);
    } else {
      replies.push({ id: message._id, at: message.timestamp, fingerprint: text.slice(0, 240) });
    }
  }
  return { replies, lastOwnAt };
};

const newestReplyAt = (summary: ChatSummary) =>
  summary.replies.reduce((newest, reply) => Math.max(newest, reply.at), 0);

const readSeenThrough = (conversationId: string): number | null => {
  const raw = uiState.getItem(`${SEEN_THROUGH_KEY_PREFIX}${conversationId}`);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
};

const writeSeenThrough = (conversationId: string, at: number) => {
  uiState.setItem(`${SEEN_THROUGH_KEY_PREFIX}${conversationId}`, String(at));
};

const readWindowAttention = () =>
  typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();

const subscribeWindowAttention = (listener: () => void) => {
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
    document.removeEventListener("visibilitychange", listener);
  };
};

const overlayIconFor = (count: number): string | undefined => {
  if (window.electronAPI?.platform !== "win32" || count <= 0) return undefined;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#e5484d";
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.fill();
  const label = count > 99 ? "99+" : String(count);
  context.fillStyle = "#ffffff";
  context.font = `600 ${label.length > 2 ? 13 : label.length > 1 ? 17 : 20}px "Segoe UI", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, size / 2, size / 2 + 1);
  return canvas.toDataURL("image/png");
};

const publishBadge = (count: number) => {
  window.electronAPI?.system?.setUnreadBadge?.({
    count,
    ...(count > 0 ? { overlayIconDataUrl: overlayIconFor(count) } : {}),
  });
};

type SoundSession = {
  conversationId: string;
  knownIds: Set<string>;
  recentFingerprints: Map<string, number>;
  lastSoundAt: number;
};

export function ChatMessageAlerts({
  conversationId,
  isOnChatRoute,
}: {
  conversationId: string | null;
  isOnChatRoute: boolean;
}) {
  const messages = useChatMessages();
  const chat = useChatRuntime();
  const windowAttention = useSyncExternalStore(subscribeWindowAttention, readWindowAttention);
  const summary = useMemo(() => summarize(messages), [messages]);
  const loaded = conversationId !== null && !chat.conversation.isInitialLoading;
  const attentive =
    windowAttention && isOnChatRoute && !chat.showHomeContent && chat.scroll.isNearBottom;

  const [seen, setSeen] = useState<{ conversationId: string; at: number } | null>(null);

  useEffect(() => {
    if (!loaded || !conversationId) return;
    const stored = readSeenThrough(conversationId);
    const newest = Math.max(newestReplyAt(summary), summary.lastOwnAt);
    let at = stored ?? newest;
    if (stored === null || (attentive && newest > stored)) {
      at = newest;
      writeSeenThrough(conversationId, at);
    }
    setSeen((previous) =>
      previous?.conversationId === conversationId && previous.at === at ? previous : { conversationId, at },
    );
  }, [attentive, conversationId, loaded, summary]);

  const unread = useMemo(() => {
    if (!loaded || !seen || seen.conversationId !== conversationId) return 0;
    const since = Math.max(seen.at, summary.lastOwnAt);
    return summary.replies.filter((reply) => reply.at > since).length;
  }, [conversationId, loaded, seen, summary]);

  useEffect(() => {
    publishBadge(unread);
  }, [unread]);

  useEffect(() => () => publishBadge(0), []);

  const sessionRef = useRef<SoundSession | null>(null);
  const attentiveRef = useRef(attentive);
  attentiveRef.current = attentive;

  useEffect(() => {
    if (!loaded || !conversationId) return;
    const session = sessionRef.current;
    if (!session || session.conversationId !== conversationId) {
      sessionRef.current = {
        conversationId,
        knownIds: new Set(summary.replies.map((reply) => reply.id)),
        recentFingerprints: new Map(summary.replies.map((reply) => [reply.fingerprint, reply.at])),
        lastSoundAt: 0,
      };
      return;
    }
    const knownThrough = Math.max(0, ...[...session.recentFingerprints.values()]);
    let arrived = false;
    for (const reply of summary.replies) {
      if (session.knownIds.has(reply.id)) continue;
      session.knownIds.add(reply.id);
      const sameReplyAt = session.recentFingerprints.get(reply.fingerprint);
      session.recentFingerprints.set(reply.fingerprint, Math.max(sameReplyAt ?? 0, reply.at));
      if (sameReplyAt !== undefined && Math.abs(reply.at - sameReplyAt) < SAME_REPLY_WINDOW_MS) continue;
      if (reply.at < knownThrough) continue;
      arrived = true;
    }
    if (!arrived || attentiveRef.current) return;
    const preferences = messageSoundPreferences();
    const now = Date.now();
    if (!preferences.enabled || now - session.lastSoundAt < MIN_SOUND_GAP_MS) return;
    session.lastSoundAt = now;
    void (async () => {
      const quiet = await window.electronAPI?.system?.isQuiet?.().catch(() => false);
      if (quiet || attentiveRef.current) return;
      await playMessageSound(preferences.sound);
    })();
  }, [conversationId, loaded, summary]);

  return null;
}
