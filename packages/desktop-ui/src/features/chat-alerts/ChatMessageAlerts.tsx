import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import { useChatMessages } from "@/context/use-chat-messages";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { uiState } from "@/platform/ui-state";
import { messageSoundPreferences, playMessageSound } from "./message-sound";

const SEEN_SEQUENCE_KEY_PREFIX = "stella.chatSeenSequence:";
const MIN_SOUND_GAP_MS = 1_500;

type Reply = {
  id: string;
  sequence: number | undefined;
  afterOwn: boolean;
  fingerprint: string;
};

type ChatSummary = {
  replies: Reply[];
  newestSequence: number;
  lastOwnSequence: number;
};

type Seen = {
  conversationId: string;
  sequence: number;
  unrecorded: ReadonlySet<string>;
};

const visibleText = (message: MessageRecord): string => {
  const text = (message.payload as { text?: unknown } | undefined)?.text;
  return typeof text === "string" ? text.trim() : "";
};

const summarize = (messages: readonly MessageRecord[]): ChatSummary => {
  let replies: Reply[] = [];
  let newestSequence = -1;
  let lastOwnSequence = -1;
  for (const message of messages) {
    if (message.type !== "assistant_message" && message.type !== "user_message") continue;
    if (isUiHiddenChatMessagePayload(message.payload ?? null)) continue;
    const text = visibleText(message);
    if (!text) continue;
    const { sequence } = message;
    newestSequence = Math.max(newestSequence, sequence ?? -1);
    if (message.type === "user_message") {
      lastOwnSequence = Math.max(lastOwnSequence, sequence ?? -1);
      replies = replies.map((reply) => (reply.afterOwn ? { ...reply, afterOwn: false } : reply));
    } else {
      replies.push({ id: message._id, sequence, afterOwn: true, fingerprint: text.slice(0, 240) });
    }
  }
  return { replies, newestSequence, lastOwnSequence };
};

const readSeenSequence = (conversationId: string): number | null => {
  const raw = uiState.getItem(`${SEEN_SEQUENCE_KEY_PREFIX}${conversationId}`);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
};

const writeSeenSequence = (conversationId: string, sequence: number) => {
  uiState.setItem(`${SEEN_SEQUENCE_KEY_PREFIX}${conversationId}`, String(sequence));
};

const unrecordedFingerprints = (summary: ChatSummary): string[] =>
  summary.replies.flatMap((reply) =>
    reply.sequence === undefined ? [reply.fingerprint] : [],
  );

const unreadCount = (summary: ChatSummary, seen: Seen): number => {
  const alreadySeen = new Set(seen.unrecorded);
  const since = Math.max(seen.sequence, summary.lastOwnSequence);
  return summary.replies.filter((reply) => {
    const newer = reply.sequence === undefined ? reply.afterOwn : reply.sequence > since;
    return newer && !alreadySeen.delete(reply.fingerprint);
  }).length;
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
  known: ReadonlyMap<string, string>;
  knownThrough: number;
  lastSoundAt: number;
};

const knownReplies = (summary: ChatSummary): ReadonlyMap<string, string> =>
  new Map(summary.replies.map((reply) => [reply.id, reply.fingerprint]));

const takesPlaceOfKnown = (
  session: SoundSession,
  current: ReadonlyMap<string, string>,
  reply: Reply,
): boolean => {
  for (const [id, fingerprint] of session.known) {
    if (fingerprint === reply.fingerprint && !current.has(id)) return true;
  }
  return false;
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

  const [seen, setSeen] = useState<Seen | null>(null);

  useEffect(() => {
    if (!loaded || !conversationId) return;
    const stored = readSeenSequence(conversationId);
    const sequence =
      stored === null || attentive
        ? Math.max(stored ?? -1, summary.newestSequence)
        : stored;
    if (sequence !== stored && sequence >= 0) writeSeenSequence(conversationId, sequence);
    setSeen((previous) => {
      const current = previous?.conversationId === conversationId ? previous : null;
      const unrecorded = attentive || !current
        ? unrecordedFingerprints(summary)
        : [...current.unrecorded];
      return current &&
        current.sequence === sequence &&
        current.unrecorded.size === unrecorded.length &&
        unrecorded.every((fingerprint) => current.unrecorded.has(fingerprint))
        ? current
        : { conversationId, sequence, unrecorded: new Set(unrecorded) };
    });
  }, [attentive, conversationId, loaded, summary]);

  const unread = useMemo(
    () =>
      loaded && seen && seen.conversationId === conversationId
        ? unreadCount(summary, seen)
        : 0,
    [conversationId, loaded, seen, summary],
  );

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
    const current = knownReplies(summary);
    if (!session || session.conversationId !== conversationId) {
      sessionRef.current = {
        conversationId,
        known: current,
        knownThrough: summary.newestSequence,
        lastSoundAt: 0,
      };
      return;
    }
    const arrived = summary.replies.some(
      (reply) =>
        !session.known.has(reply.id) &&
        (reply.sequence === undefined || reply.sequence > session.knownThrough) &&
        !takesPlaceOfKnown(session, current, reply),
    );
    session.known = current;
    session.knownThrough = Math.max(session.knownThrough, summary.newestSequence);
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
