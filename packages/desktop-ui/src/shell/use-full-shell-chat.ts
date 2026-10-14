import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { deriveComposerState } from "@/features/chat/composer-context";
import { conversationTabs } from "@/features/chat/services/conversation-tabs-store";
import { useConversationActivity } from "@/features/chat/hooks/use-conversation-activity";
import { useConversationDisplayMessages } from "@/features/chat/hooks/use-conversation-display-messages";
import { useConversationFiles } from "@/features/chat/hooks/use-conversation-files";
import { useConversationMessages } from "@/features/chat/hooks/use-conversation-messages";
import {
  useComposerMessageSelector,
  useComposerMessageStore,
} from "@/features/chat/hooks/use-composer-message-state";
import { takePendingComposerDraft } from "@/global/onboarding/chat/pending-handoff";
import { useStreamingChat } from "@/features/chat/hooks/use-streaming-chat";
import { useThreadActivity } from "@/features/chat/hooks/use-thread-activity";
import { buildActivityTasks } from "@/features/chat/lib/event-transforms";
import { useCapturedChatContext } from "./use-captured-chat-context";
import { useTurnHandoff } from "./use-turn-handoff";
import { useChatScrollManagement } from "./use-chat-scroll-management";
import { useChatHomeSurface } from "./use-chat-home-surface";
import { useConversationUserAsks } from "@/features/user-ask/user-ask-store";
import { useAgentInputRouting } from "./use-agent-input-routing";
import { useStellaSendMessageBridge } from "./use-stella-send-message-bridge";
import { useChatStore } from "@/context/chat-store-context";
import { useCloudChatBridge } from "@/features/cloud/use-cloud-chat-bridge";
import { usePiChat } from "@/features/chat/pi/use-pi-chat";
import { remoteTurnRunning } from "@/features/chat/pi/remote-turn-running";
import {
  journaledPiTurns,
  piAgentActivityEvents,
  piPendingLogRows,
  piPendingRows,
} from "@/features/chat/pi/pi-chat-records";
import {
  mergeEvents,
  replyFileEvents,
} from "@/features/chat/lib/reply-file-events";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import { cloudAttachmentsStore } from "@/features/cloud/cloud-composer-store";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { acceptedUserMessageIds } from "@/features/chat/lib/accepted-user-message-ids";
import type { EventRecord } from "@stella/contracts/local-chat";
import type { StreamingAssistantOverlay } from "@/features/chat/streaming/streaming-types";
import type { ChatContext } from "@/shared/types/electron";

type TabComposerMemory = {
  message: string;
  chatContext: ChatContext | null;
  selectedText: string | null;
};
const MAX_RETAINED_TAB_STATE = 20;
const NO_NEWER_CLOUD_MESSAGES = () => false;
const EMPTY_EVENTS: EventRecord[] = [];
const NO_STREAMING_ASSISTANTS: StreamingAssistantOverlay[] = [];
const NO_JOURNALED_TURNS: ReturnType<typeof journaledPiTurns> = new Map();
const NO_PI_PENDING_ROWS: ReturnType<typeof piPendingRows> = {
  messages: [],
  journalUserIds: new Map(),
};
const useOwnDeviceId = (enabled: boolean) => {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void getDeviceIdOrNull().then((next) => {
      if (!cancelled) setDeviceId(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled ? deviceId : null;
};
const hasNonWhitespaceText = (text: string) => text.trim().length > 0;
const setBoundedTabMemory = <T>(
  memory: Map<string, T>,
  conversationId: string,
  value: T,
) => {
  memory.delete(conversationId);
  memory.set(conversationId, value);
  while (memory.size > MAX_RETAINED_TAB_STATE) {
    const oldestConversationId = memory.keys().next().value;
    if (typeof oldestConversationId !== "string") break;
    memory.delete(oldestConversationId);
  }
};
export function useFullShellChat({
  activeConversationId,
  isOnChatRoute,
}: {
  activeConversationId: string | null;
  isOnChatRoute: boolean;
}) {
  const { cloudFeaturesEnabled, storageMode } = useChatStore();
  const { accountScope } = useCloudConversationSession();
  const { store: composerMessageStore, setMessage } =
    useComposerMessageStore();
  const hasComposerText = useComposerMessageSelector(
    composerMessageStore,
    hasNonWhitespaceText,
  );
  const [composerFocusRequestId, setComposerFocusRequestId] = useState(0);
  const { chatContext, setChatContext, selectedText, setSelectedText } =
    useCapturedChatContext();
  const composerMemoryByConversationRef = useRef(
    new Map<string, TabComposerMemory>(),
  );
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const previousComposerConversationIdRef = useRef<string | null>(
    activeConversationId,
  );
  const pendingAutoSendTextRef = useRef<string | null>(null);
  // Auth scope is a hard renderer privacy boundary. Clear composer content,
  // attachment handles, and per-tab memories in a layout effect so no frame
  // can paint the previous owner's unsent text during identity bootstrap.
  // Keyed on the scope it last cleared for: Fast Refresh re-runs every effect
  // of an edited component, and an applied renderer change must not wipe the
  // same owner's unsent text.
  const clearedForScopeRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const scope = `${accountScope}\0${storageMode}`;
    if (clearedForScopeRef.current === scope) return;
    clearedForScopeRef.current = scope;
    composerMemoryByConversationRef.current.clear();
    previousComposerConversationIdRef.current = null;
    setMessage("");
    setChatContext(null);
    setSelectedText(null);
    cloudAttachmentsStore.clear();
  }, [accountScope, storageMode, setChatContext, setMessage, setSelectedText]);
  useEffect(() => {
    const previousConversationId = previousComposerConversationIdRef.current;
    if (previousConversationId === activeConversationId) return;
    if (previousConversationId) {
      const remainsOpen = conversationTabs
        .getSnapshot()
        .tabs.some((tab) => tab.conversationId === previousConversationId);
      if (remainsOpen) {
        setBoundedTabMemory(
          composerMemoryByConversationRef.current,
          previousConversationId,
          {
            message: composerMessageStore.getSnapshot(),
            chatContext,
            selectedText,
          },
        );
      }
    }
    if (activeConversationId) {
      const remembered =
        composerMemoryByConversationRef.current.get(activeConversationId);
      const pendingDraft = remembered?.message
        ? null
        : takePendingComposerDraft();
      pendingAutoSendTextRef.current = pendingDraft?.send
        ? pendingDraft.text
        : null;
      setMessage(remembered?.message ?? pendingDraft?.text ?? "");
      setChatContext(remembered?.chatContext ?? null);
      setSelectedText(remembered?.selectedText ?? null);
    }
    previousComposerConversationIdRef.current = activeConversationId;
  }, [
    activeConversationId,
    chatContext,
    composerMessageStore,
    selectedText,
    setChatContext,
    setMessage,
    setSelectedText,
  ]);
  useEffect(
    () =>
      conversationTabs.subscribe(() => {
        const openIds = new Set(
          conversationTabs.getSnapshot().tabs.map((tab) => tab.conversationId),
        );
        for (const conversationId of composerMemoryByConversationRef.current.keys()) {
          if (!openIds.has(conversationId)) {
            composerMemoryByConversationRef.current.delete(conversationId);
          }
        }
      }),
    [],
  );
  const localMessageFeed = useConversationMessages(
    activeConversationId ?? undefined,
  );
  const { messages: localPersistedMessages } = localMessageFeed;
  const localActivityFeed = useConversationActivity(
    activeConversationId ?? undefined,
  );
  const { activities: localActivities } = localActivityFeed;
  const localFileFeed = useConversationFiles(activeConversationId ?? undefined);
  const { files: localPersistedFiles } = localFileFeed;
  const { records: threadActivityRecords } = useThreadActivity(
    activeConversationId ?? undefined,
  );
  const {
    optimisticEvents: localOptimisticEvents,
    acknowledgeMessages: acknowledgeLocalMessages,
    queuedUserMessages: localQueuedUserMessages,
    removeQueuedUserMessage: localRemoveQueuedUserMessage,
    sendMessage: localSendMessage,
    pendingUserMessageId: localPendingUserMessageId,
  } = useStreamingChat({
    conversationId: activeConversationId,
    persistedMessages: localPersistedMessages,
  });
  const localTasks = useMemo(
    () => buildActivityTasks(threadActivityRecords),
    [threadActivityRecords],
  );
  const piChat = usePiChat(activeConversationId);
  const cloudChat = useCloudChatBridge({
    conversationId: activeConversationId,
    enabled: cloudFeaturesEnabled,
    localMessages: localPersistedMessages,
    localActivities,
    localFiles: localPersistedFiles,
    localTasks,
  });
  const isPrivateChat = storageMode === "local";
  const journalState = cloudChat.conversation.state;
  const ownDeviceId = useOwnDeviceId(cloudFeaturesEnabled);
  const journaledTurns = useMemo(
    () =>
      cloudFeaturesEnabled
        ? journaledPiTurns(
            cloudChat.records,
            piChat.projection.turns,
            ownDeviceId,
          )
        : NO_JOURNALED_TURNS,
    [
      cloudChat.records,
      cloudFeaturesEnabled,
      ownDeviceId,
      piChat.projection.turns,
    ],
  );
  const recordLoaded = cloudFeaturesEnabled
    ? journalState.recordsSource !== "none"
    : isPrivateChat && !localMessageFeed.isInitialLoading;
  const recordHasOlder = cloudFeaturesEnabled
    ? journalState.hasOlder
    : localMessageFeed.hasOlderMessages;
  const recordStartMs = cloudFeaturesEnabled
    ? (cloudChat.records[0]?.createdAtMs ?? null)
    : (cloudChat.persistedMessages[0]?.timestamp ?? null);
  const piPending = useMemo(() => {
    if (!activeConversationId || !recordLoaded) {
      return NO_PI_PENDING_ROWS;
    }
    if (recordHasOlder && recordStartMs === null) return NO_PI_PENDING_ROWS;
    const sinceMs = recordHasOlder ? recordStartMs : null;
    return cloudFeaturesEnabled
      ? piPendingRows({
          projection: piChat.projection,
          journaled: journaledTurns,
          canonical: cloudChat.persistedMessages,
          sinceMs,
        })
      : piPendingLogRows({
          projection: piChat.projection,
          log: cloudChat.persistedMessages,
          conversationId: activeConversationId,
          sinceMs,
        });
  }, [
    activeConversationId,
    cloudChat.persistedMessages,
    cloudFeaturesEnabled,
    journaledTurns,
    piChat.projection,
    recordHasOlder,
    recordLoaded,
    recordStartMs,
  ]);
  const persistedMessages = useMemo(
    () =>
      piPending.messages.length > 0
        ? [...cloudChat.persistedMessages, ...piPending.messages]
        : cloudChat.persistedMessages,
    [cloudChat.persistedMessages, piPending.messages],
  );
  useEffect(() => {
    acknowledgeLocalMessages(persistedMessages);
  }, [acknowledgeLocalMessages, persistedMessages, localOptimisticEvents]);
  const awaitingMessageAdmission = useMemo(() => {
    const persistedIds = acceptedUserMessageIds(persistedMessages);
    return localOptimisticEvents.some(
      (event) => event.type === "user_message" && !persistedIds.has(event._id),
    );
  }, [localOptimisticEvents, persistedMessages]);
  const piAgentEvents = useMemo(
    () => piAgentActivityEvents(threadActivityRecords),
    [threadActivityRecords],
  );
  const activities = useMemo(
    () => mergeEvents(cloudChat.activities, piAgentEvents),
    [cloudChat.activities, piAgentEvents],
  );
  const replyFiles = useMemo(
    () =>
      cloudFeaturesEnabled
        ? replyFileEvents(persistedMessages)
        : EMPTY_EVENTS,
    [cloudFeaturesEnabled, persistedMessages],
  );
  const persistedFiles = useMemo(
    () =>
      mergeEvents(
        cloudChat.files,
        replyFiles,
        piAgentEvents.filter((event) => event.type === "agent-completed"),
      ),
    [cloudChat.files, piAgentEvents, replyFiles],
  );
  const tasks = cloudChat.tasks;
  const optimisticEvents = cloudChat.isWebShell
    ? cloudChat.optimisticEvents
    : localOptimisticEvents;
  const runtimeStatusText = piChat.runtimeStatusText;
  const isCompacting = piChat.isCompacting;
  const activeToolCallId = piChat.activeToolCallId;
  const activeToolName = piChat.activeToolName;
  const latestCompletedTool = piChat.latestCompletedTool;
  const hasToolActivity = piChat.hasToolActivity;
  const isToolActive = piChat.isToolActive;
  const runningElsewhere = useMemo(
    () =>
      remoteTurnRunning({
        socketLive: cloudFeaturesEnabled && cloudChat.conversation.state.status === "live",
        live: cloudChat.conversation.state.live,
        records: cloudChat.records,
        polled: piChat.remoteTurns,
        ownDeviceId,
      }),
    [
      cloudChat.conversation.state.live,
      cloudChat.conversation.state.status,
      cloudChat.records,
      cloudFeaturesEnabled,
      ownDeviceId,
      piChat.remoteTurns,
    ],
  );
  const turnRunning = piChat.isRunningHere || runningElsewhere;
  const awaitingTurnHandoff = useTurnHandoff({
    conversationId: activeConversationId,
    optimisticEvents: localOptimisticEvents,
    persistedMessages,
    awaitingAdmission: awaitingMessageAdmission,
    turnRunning,
  });
  const isStreaming =
    turnRunning || awaitingMessageAdmission || awaitingTurnHandoff;
  const answerLanded = !awaitingMessageAdmission && piChat.answerLanded;
  const pendingUserMessageId = cloudChat.isWebShell
    ? cloudChat.pendingUserMessageId
    : localPendingUserMessageId;
  const queuedUserMessages = cloudChat.isWebShell
    ? []
    : localQueuedUserMessages;
  const removeQueuedUserMessage = cloudChat.isWebShell
    ? () => {}
    : localRemoveQueuedUserMessage;
  const sendMessage = cloudChat.isWebShell
    ? cloudChat.sendMessage
    : localSendMessage;
  const cancelCurrentStream = piChat.cancelCurrentStream;
  const hasOlderMessages = isPrivateChat
    ? localMessageFeed.hasOlderMessages
    : cloudChat.conversation.state.hasOlder;
  const hasNewerMessages = isPrivateChat
    ? localMessageFeed.hasNewerMessages
    : false;
  const isLoadingOlderMessages = isPrivateChat
    ? localMessageFeed.isLoadingOlder
    : cloudChat.conversation.state.loadingOlder;
  const isLoadingNewerMessages = isPrivateChat
    ? localMessageFeed.isLoadingNewer
    : false;
  const isInitialLoadingMessages = isPrivateChat
    ? localMessageFeed.isInitialLoading
    : cloudChat.isInitialLoading;
  const loadOlderMessages = isPrivateChat
    ? localMessageFeed.loadOlder
    : cloudChat.conversation.loadOlder;
  const loadNewerMessages = isPrivateChat
    ? localMessageFeed.loadNewer
    : NO_NEWER_CLOUD_MESSAGES;
  const loadLatestMessages = isPrivateChat
    ? localMessageFeed.loadLatest
    : NO_NEWER_CLOUD_MESSAGES;
  const hasOlderActivity = isPrivateChat
    ? localActivityFeed.hasOlderActivity
    : cloudChat.hasOlderActivity;
  const isLoadingOlderActivity = isPrivateChat
    ? localActivityFeed.isLoadingOlder
    : cloudChat.isLoadingOlderActivity;
  const loadOlderActivity = isPrivateChat
    ? localActivityFeed.loadOlder
    : cloudChat.loadOlderActivity;
  const hasOlderFiles = isPrivateChat
    ? localFileFeed.hasOlderFiles
    : cloudChat.conversation.state.hasOlder;
  const isLoadingOlderFiles = isPrivateChat
    ? localFileFeed.isLoadingOlder
    : cloudChat.conversation.state.loadingOlder;
  const loadOlderFiles = isPrivateChat
    ? localFileFeed.loadOlder
    : cloudChat.conversation.loadOlder;
  const displayMessages = useConversationDisplayMessages({
    conversationId: activeConversationId,
    persistedMessages,
    optimisticEvents,
    streamingAssistants: NO_STREAMING_ASSISTANTS,
  });
  const hasMessages = displayMessages.length > 0;
  const conversationAsks = useConversationUserAsks(activeConversationId);
  const hasOpenQuestion = conversationAsks.length > 0;
  const {
    showHomeContent,
    enterChatSurfaceForInteraction,
    resetIdleTimer,
    dismissHome,
    showHome,
  } = useChatHomeSurface({
    isOnChatRoute,
    hasMessages,
    isInitialLoading: isInitialLoadingMessages,
    isStreaming,
    activeConversationId,
    hasOpenQuestion,
  });
  useEffect(() => {
    if (!isOnChatRoute) return;
    setComposerFocusRequestId((id) => id + 1);
  }, [isOnChatRoute, activeConversationId]);
  const {
    sendContextlessMessage,
    sendAgentInputMessage,
    sendMessageWithContext,
  } = useAgentInputRouting({
    activeConversationId,
    sendMessage,
    enterChatSurfaceForInteraction,
  });
  useStellaSendMessageBridge({
    sendContextlessMessage,
    sendAgentInputMessage,
  });
  const {
    list,
    isPlacingInitialScroll,
    isAtBottom,
    isNearBottom,
    isFollowingLatest,
    isUserScrolling,
    noteManualScroll,
    getIsFollowing,
    getShouldFollowSend,
    getIsEffectivelyAtBottom,
    showScrollButton,
    scrollToBottom,
    releaseFollow,
    followAfterSend,
    thumbRef,
  } = useChatScrollManagement({
    hasOlderEvents: hasOlderMessages,
    isLoadingOlder: isLoadingOlderMessages,
    onLoadOlder: loadOlderMessages,
    hasNewerEvents: hasNewerMessages,
    isLoadingNewer: isLoadingNewerMessages,
    onLoadNewer: loadNewerMessages,
    onLoadLatest: loadLatestMessages,
    paginationKey: activeConversationId,
  });
  const isOpeningScroll =
    Boolean(activeConversationId) &&
    displayMessages.length > 0 &&
    isPlacingInitialScroll;
  const handleSend = useCallback(async () => {
    const shouldFollowSend =
      showHomeContent || getIsEffectivelyAtBottom() || getShouldFollowSend();
    const submittedConversationId = activeConversationId;
    const submittedMessage = composerMessageStore.getSnapshot();
    const submittedSelectedText = selectedText;
    const submittedChatContext = chatContext;
    const submittedFromHome = showHomeContent;
    const accepted = await sendMessage({
      text: submittedMessage,
      selectedText: submittedSelectedText,
      chatContext: submittedChatContext,
      onClear: () => {
        if (activeConversationIdRef.current !== submittedConversationId) {
          if (submittedConversationId) {
            setBoundedTabMemory(
              composerMemoryByConversationRef.current,
              submittedConversationId,
              {
                message: "",
                selectedText: null,
                chatContext: null,
              },
            );
          }
          return;
        }
        setMessage("");
        setSelectedText(null);
        setChatContext(null);
      },
      onOptimisticStart: () => {
        if (activeConversationIdRef.current !== submittedConversationId) return;
        enterChatSurfaceForInteraction();
        resetIdleTimer();
        if (shouldFollowSend) {
          followAfterSend();
        } else if (!isStreaming) {
          releaseFollow();
        }
      },
      onRestore: () => {
        if (activeConversationIdRef.current !== submittedConversationId) {
          if (submittedConversationId) {
            const remembered: Partial<TabComposerMemory> =
              composerMemoryByConversationRef.current.get(
                submittedConversationId,
              ) ?? {};
            setBoundedTabMemory(
              composerMemoryByConversationRef.current,
              submittedConversationId,
              {
                message: remembered.message || submittedMessage,
                selectedText: remembered.selectedText ?? submittedSelectedText,
                chatContext: remembered.chatContext ?? submittedChatContext,
              },
            );
          }
          return;
        }
        const shouldRestoreHome =
          submittedFromHome && !composerMessageStore.getSnapshot();
        setMessage((current) => current || submittedMessage);
        setSelectedText((current) => current ?? submittedSelectedText);
        setChatContext((current) => current ?? submittedChatContext);
        if (shouldRestoreHome) showHome();
      },
    });
    if (
      !accepted ||
      activeConversationIdRef.current !== submittedConversationId
    ) {
      return;
    }
    if (submittedFromHome) {
      setComposerFocusRequestId((id) => id + 1);
    }
  }, [
    activeConversationId,
    chatContext,
    enterChatSurfaceForInteraction,
    getIsFollowing,
    getShouldFollowSend,
    getIsEffectivelyAtBottom,
    isStreaming,
    composerMessageStore,
    followAfterSend,
    releaseFollow,
    resetIdleTimer,
    selectedText,
    sendMessage,
    setChatContext,
    setMessage,
    setSelectedText,
    showHome,
    showHomeContent,
  ]);
  const { canSubmit } = deriveComposerState({
    hasMessage: hasComposerText,
    chatContext,
    selectedText,
    conversationId: activeConversationId,
    requireConversationId: true,
  });
  const autoSendDraftReady = useComposerMessageSelector(
    composerMessageStore,
    (text) =>
      pendingAutoSendTextRef.current !== null &&
      text === pendingAutoSendTextRef.current,
  );
  useEffect(() => {
    const text = pendingAutoSendTextRef.current;
    if (!text || !canSubmit || isStreaming) return;
    if (composerMessageStore.getSnapshot() !== text) return;
    pendingAutoSendTextRef.current = null;
    void handleSend();
  }, [
    autoSendDraftReady,
    canSubmit,
    handleSend,
    isStreaming,
    composerMessageStore,
  ]);
  const chatColumnConversation = useMemo(
    () => ({
      conversationId: activeConversationId,
      tasks,
      tasksLoaded: cloudChat.tasksLoaded,
      extraTail: cloudChat.extraTail,
      activity: {
        activities,
        hasOlder: hasOlderActivity,
        isLoadingOlder: isLoadingOlderActivity,
        loadOlder: loadOlderActivity,
      },
      files: {
        files: persistedFiles,
        hasOlder: hasOlderFiles,
        isLoadingOlder: isLoadingOlderFiles,
        loadOlder: loadOlderFiles,
      },
      streaming: {
        isStreaming,
        answerLanded,
        runtimeStatusText,
        isCompacting,
        activeToolCallId,
        activeToolName,
        latestCompletedTool,
        hasToolActivity,
        isToolActive,
        pendingUserMessageId,
        queuedUserMessages,
        removeQueuedUserMessage,
      },
      history: {
        hasOlderMessages,
        hasNewerMessages,
        isLoadingOlder: isLoadingOlderMessages,
        isLoadingNewer: isLoadingNewerMessages,
        isInitialLoading: isInitialLoadingMessages,
        loadOlder: loadOlderMessages,
      },
    }),
    [
      activeConversationId,
      activities,
      cloudChat.extraTail,
      cloudChat.tasksLoaded,
      activeToolCallId,
      activeToolName,
      latestCompletedTool,
      hasToolActivity,
      hasOlderActivity,
      hasOlderFiles,
      hasOlderMessages,
      hasNewerMessages,
      isInitialLoadingMessages,
      isLoadingOlderActivity,
      isLoadingOlderFiles,
      isLoadingOlderMessages,
      isLoadingNewerMessages,
      tasks,
      loadOlderActivity,
      loadOlderFiles,
      loadOlderMessages,
      pendingUserMessageId,
      persistedFiles,
      queuedUserMessages,
      removeQueuedUserMessage,
      runtimeStatusText,
      isCompacting,
      isStreaming,
      answerLanded,
      isToolActive,
    ],
  );
  const chatColumnComposer = useMemo(
    () => ({
      messageStore: composerMessageStore,
      setMessage,
      chatContext,
      setChatContext,
      selectedText,
      setSelectedText,
      canSubmit,
      focusRequestId: composerFocusRequestId,
      requestFocus: () => setComposerFocusRequestId((id) => id + 1),
      onSend: handleSend,
      onStop: cancelCurrentStream,
    }),
    [
      composerMessageStore,
      setMessage,
      chatContext,
      setChatContext,
      selectedText,
      setSelectedText,
      canSubmit,
      composerFocusRequestId,
      handleSend,
      cancelCurrentStream,
    ],
  );
  const chatColumnScroll = useMemo(
    () => ({
      list,
      showScrollButton,
      isAtBottom,
      isNearBottom,
      isFollowingLatest,
      isUserScrolling,
      noteManualScroll,
      getIsFollowing,
      scrollToBottom,
      thumbRef,
      isOpeningScroll,
    }),
    [
      isOpeningScroll,
      list,
      showScrollButton,
      isAtBottom,
      isNearBottom,
      isFollowingLatest,
      isUserScrolling,
      noteManualScroll,
      getIsFollowing,
      scrollToBottom,
      thumbRef,
    ],
  );
  const conversation = useMemo(
    () => ({
      ...chatColumnConversation,
      hasOlderMessages,
      hasNewerMessages,
      isLoadingOlder: isLoadingOlderMessages,
      isLoadingNewer: isLoadingNewerMessages,
      isInitialLoading: isInitialLoadingMessages,
      loadOlderMessages,
      loadNewerMessages,
      loadLatestMessages,
      isStreaming,
      pendingUserMessageId,
      queuedUserMessages,
      sendMessage,
      sendContextlessMessage,
      sendMessageWithContext,
      cancelCurrentStream,
    }),
    [
      chatColumnConversation,
      hasOlderMessages,
      hasNewerMessages,
      isLoadingOlderMessages,
      isLoadingNewerMessages,
      isInitialLoadingMessages,
      loadOlderMessages,
      loadNewerMessages,
      loadLatestMessages,
      isStreaming,
      pendingUserMessageId,
      queuedUserMessages,
      sendMessage,
      sendContextlessMessage,
      sendMessageWithContext,
      cancelCurrentStream,
    ],
  );
  const composer = useMemo(
    () => ({
      ...chatColumnComposer,
      handleSend,
      handleStop: cancelCurrentStream,
    }),
    [chatColumnComposer, handleSend, cancelCurrentStream],
  );
  const runtime = useMemo(
    () => ({
      conversation,
      composer,
      scroll: chatColumnScroll,
      showHomeContent,
      dismissHome,
      showHome,
    }),
    [
      conversation,
      composer,
      chatColumnScroll,
      showHomeContent,
      dismissHome,
      showHome,
    ],
  );
  return { runtime, messages: displayMessages };
}
