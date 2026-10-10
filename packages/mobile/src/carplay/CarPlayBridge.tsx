import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { authClient } from "../lib/auth-client";
import {
  useCloudCanonicalChatThread,
  useCloudConversationAuthority,
} from "../lib/use-cloud-canonical-chat-thread";
import type { CloudConversationAuthority } from "../lib/cloud-conversation-authority";
import { useDictation } from "../lib/dictation";
import { useChatDraft } from "../lib/chat-draft-store";
import {
  getReadAloudPlaybackState,
  speakReply,
  stopReadAloud,
  useReadAloudState,
} from "../lib/read-aloud";
import type { ChatMessage } from "../types";
import {
  buildHome,
  REPLAY_ROW_ID,
  TALK_ROW_ID,
  type CarPlayHomeState,
  type CarPlayPhase,
} from "./carplay-home";
import {
  carPlayNative,
  relaxKeychainAccessibility,
  useCarPlayConnected,
  useCarPlayEvents,
  useCarPlayHome,
} from "./native";
import { ReplyQueue } from "./reply-queue";

const SEND_START_TIMEOUT_MS = 1500;
const NOTICE_MS = 4000;

export function CarPlayBridge() {
  if (Platform.OS !== "ios" || !carPlayNative) return null;
  return <CarPlayBridgeIOS />;
}

function CarPlayBridgeIOS() {
  useEffect(() => {
    relaxKeychainAccessibility();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") relaxKeychainAccessibility();
    });
    return () => subscription.remove();
  }, []);
  const connected = useCarPlayConnected();
  const session = authClient.useSession();
  if (!connected) return null;
  if (!session.data) {
    return (
      <StaticHome state={session.isPending ? { kind: "connecting" } : { kind: "signedOut" }} />
    );
  }
  return <CarPlayCloudChatGate anonymous={session.data.user?.isAnonymous === true} />;
}

function StaticHome({ state }: { state: CarPlayHomeState }) {
  useCarPlayHome(buildHome(state));
  useCarPlayEvents({});
  return null;
}

function CarPlayCloudChatGate({ anonymous }: { anonymous: boolean }) {
  const authority = useCloudConversationAuthority();
  if (authority.status !== "ready") return <StaticHome state={{ kind: "connecting" }} />;
  return (
    <CarPlayVoiceLoop
      key={`${authority.authority.accountScope}:${authority.authority.ownerGeneration}:${authority.authority.conversationId}`}
      authority={authority.authority}
      reloadAuthority={authority.retry}
      anonymous={anonymous}
    />
  );
}

function CarPlayVoiceLoop({
  authority,
  reloadAuthority,
  anonymous,
}: {
  authority: CloudConversationAuthority;
  reloadAuthority: () => void;
  anonymous: boolean;
}) {
  const thread = useCloudCanonicalChatThread(authority, {
    reloadAuthority,
    threadId: "carplay",
  });
  const { setDraft, send, messages, sending, storageLoaded } = thread;
  const ready =
    storageLoaded && thread.catchingUp !== true && thread.authorityReady !== false;
  const draft = useChatDraft(thread.draftStore);
  const readAloud = useReadAloudState();

  const [phase, setPhase] = useState<CarPlayPhase>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  const [replies] = useState(() => new ReplyQueue());
  const [live, setLive] = useState(false);
  const baselineRef = useRef(false);
  const currentRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const awaitingReplyRef = useRef(false);
  const pendingSendRef = useRef<string | null>(null);
  const dictationStatusRef = useRef<"idle" | "recording" | "transcribing">("idle");
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPhase = useCallback(() => {
    const status = dictationStatusRef.current;
    if (status === "recording" || startingRef.current) setPhase("listening");
    else if (status === "transcribing" || pendingSendRef.current) setPhase("thinking");
    else if (currentRef.current) setPhase("speaking");
    else if (awaitingReplyRef.current) setPhase("thinking");
    else setPhase("idle");
  }, []);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const pump = useCallback(() => {
    if (
      currentRef.current ||
      dictationStatusRef.current !== "idle" ||
      pendingSendRef.current ||
      !replies.accepting
    ) {
      refreshPhase();
      return;
    }
    const next = replies.next();
    if (!next) {
      refreshPhase();
      return;
    }
    currentRef.current = next.id;
    refreshPhase();
    void speakReply(next.text, next.id, { background: true, quiet: true }).finally(() => {
      if (
        currentRef.current === next.id &&
        getReadAloudPlaybackState()?.messageId !== next.id
      ) {
        currentRef.current = null;
        pump();
      }
    });
  }, [refreshPhase, replies]);

  const scan = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const retryIn = replies.scan(messagesRef.current, sendingRef.current);
    if (retryIn !== null) settleTimerRef.current = setTimeout(scan, retryIn);
    pump();
  }, [pump, replies]);

  useEffect(() => {
    if (!ready) return;
    if (!baselineRef.current) {
      baselineRef.current = true;
      replies.markAllKnown(messagesRef.current);
      setLive(true);
      return;
    }
    scan();
  }, [ready, messages, sending, scan, replies]);

  const prevSendingRef = useRef(sending);
  useEffect(() => {
    const wasSending = prevSendingRef.current;
    prevSendingRef.current = sending;
    if (sending && sendStartTimerRef.current) {
      clearTimeout(sendStartTimerRef.current);
      sendStartTimerRef.current = null;
    }
    if (wasSending && !sending && awaitingReplyRef.current) {
      awaitingReplyRef.current = false;
      refreshPhase();
    }
  }, [sending, refreshPhase]);

  useEffect(() => {
    const current = currentRef.current;
    if (!current) return;
    if (readAloud && readAloud.messageId === current) return;
    currentRef.current = null;
    pump();
  }, [readAloud, pump]);

  const onTranscript = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      pendingSendRef.current = trimmed;
      setDraft(trimmed);
      refreshPhase();
    },
    [setDraft, refreshPhase],
  );

  const dictation = useDictation({ anonymous, onTranscript });
  dictationStatusRef.current = dictation.status;

  useEffect(() => {
    if (dictation.status !== "recording") carPlayNative?.setVoiceControl(null);
    if (
      dictation.status === "idle" &&
      !startingRef.current &&
      !pendingSendRef.current &&
      !replies.accepting
    ) {
      replies.accepting = true;
      pump();
    }
    refreshPhase();
  }, [dictation.status, pump, refreshPhase, replies]);

  useEffect(() => {
    const pending = pendingSendRef.current;
    if (!pending || !storageLoaded || draft.trim() !== pending || sending) return;
    pendingSendRef.current = null;
    replies.markAllKnown(messagesRef.current);
    replies.clear();
    replies.accepting = true;
    awaitingReplyRef.current = true;
    send();
    if (sendStartTimerRef.current) clearTimeout(sendStartTimerRef.current);
    sendStartTimerRef.current = setTimeout(() => {
      sendStartTimerRef.current = null;
      if (!awaitingReplyRef.current || sendingRef.current) return;
      awaitingReplyRef.current = false;
      refreshPhase();
    }, SEND_START_TIMEOUT_MS);
    refreshPhase();
  }, [draft, storageLoaded, sending, send, refreshPhase, replies]);

  const sendRecording = useCallback(() => {
    if (dictationStatusRef.current !== "recording") return;
    carPlayNative?.setVoiceControl(null);
    void dictation.stop();
  }, [dictation]);

  const cancelRecording = useCallback(() => {
    carPlayNative?.setVoiceControl(null);
    if (dictationStatusRef.current === "recording") void dictation.cancel();
  }, [dictation]);

  const startListening = useCallback(() => {
    replies.accepting = false;
    replies.clear();
    currentRef.current = null;
    startingRef.current = true;
    stopReadAloud();
    setNotice(null);
    setPhase("listening");
    carPlayNative?.setVoiceControl("listening");
    void dictation.start().then((started) => {
      startingRef.current = false;
      if (started) {
        refreshPhase();
        return;
      }
      carPlayNative?.setVoiceControl(null);
      replies.accepting = true;
      showNotice("Couldn't start listening. Try again.");
      refreshPhase();
    });
  }, [dictation, refreshPhase, replies, showNotice]);

  const onTalk = useCallback(() => {
    const status = dictationStatusRef.current;
    if (status === "recording") {
      sendRecording();
      return;
    }
    if (status === "transcribing" || pendingSendRef.current || startingRef.current) return;
    startListening();
  }, [sendRecording, startListening]);

  const onReplay = useCallback(() => {
    if (dictationStatusRef.current !== "idle" || pendingSendRef.current || startingRef.current) {
      return;
    }
    const latest = [...messagesRef.current]
      .reverse()
      .find((message) => message.role === "assistant" && message.text.trim().length > 0);
    if (!latest) return;
    replies.clear();
    stopReadAloud();
    currentRef.current = null;
    replies.accepting = true;
    replies.push({ id: latest.id, text: latest.text.trim() });
    pump();
  }, [pump, replies]);

  useCarPlayEvents({
    onRowSelect: (id) => {
      if (id === TALK_ROW_ID) onTalk();
      else if (id === REPLAY_ROW_ID) onReplay();
    },
    onVoiceControlAction: (action) => {
      if (action === "send") sendRecording();
      else cancelRecording();
    },
  });

  const hasReply = messages.some(
    (message) => message.role === "assistant" && message.text.trim().length > 0,
  );
  useCarPlayHome(
    buildHome(
      live
        ? { kind: "ready", phase, hasReply, notice }
        : { kind: "connecting" },
    ),
  );

  useEffect(() => {
    carPlayNative?.setBackgroundActivity(phase !== "idle");
  }, [phase]);

  useEffect(
    () => () => {
      if (currentRef.current) stopReadAloud();
      carPlayNative?.setVoiceControl(null);
      carPlayNative?.setBackgroundActivity(false);
      for (const timer of [settleTimerRef, sendStartTimerRef, noticeTimerRef]) {
        if (timer.current) clearTimeout(timer.current);
      }
    },
    [],
  );

  return null;
}
