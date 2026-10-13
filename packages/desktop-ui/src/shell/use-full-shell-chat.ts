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
import type { LegendListRef } from "@legendapp/list/react";
import type { EventRecord } from "@stella/contracts/local-chat";
import type { StreamingAssistantOverlay } from "@/features/chat/streaming/streaming-types";
import type { ChatContext } from "@/shared/types/electron";

type TabComposerMemory = {
  message: string;
  chatContext: ChatContext | null;
  selectedText: string | null;
};
type TabScrollMemory = { scrollTop: number; followingLatest: boolean };
const MAX_RETAINED_TAB_STATE = 20;
/**
 * How long, after opening/switching into a conversation that lands at the
 * bottom, to keep re-pinning to the true end while late-rendering content
 * (agent cards, activity cards, images) settles and grows the scroll height.
 */
const OPEN_BOTTOM_SETTLE_MS = 600;
// Frames the height must hold still before an opening chat is shown.
const OPEN_BOTTOM_STABLE_FRAMES = 3;
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
export const createConversationScrollMemoryCleanup = ({
  conversationId,
  list,
  scrollMemory,
  getIsFollowing,
  isConversationOpen,
}: {
  conversationId: string | null;
  list: Pick<LegendListRef, "getScrollableNode"> | null;
  scrollMemory: Map<string, TabScrollMemory>;
  getIsFollowing: () => boolean;
  isConversationOpen: (conversationId: string) => boolean;
}) => {
  // Resolve Legend's DOM node while its internal ref is still mounted. During
  // layout cleanup the list handle can remain non-null after that internal ref
  // has already been cleared, making a late getScrollableNode() call throw.
  let element: ReturnType<LegendListRef["getScrollableNode"]> | null = null;
  if (conversationId && list) {
    try {
      element = list.getScrollableNode();
    } catch {
      // A conversation switch can race Legend's own ref teardown. Scroll
      // memory is best-effort; losing one position is safer than crashing the
      // account transition while trying to capture it.
      element = null;
    }
  }
  return () => {
    if (!conversationId || !isConversationOpen(conversationId) || !element) {
      return;
    }
    setBoundedTabMemory(scrollMemory, conversationId, {
      scrollTop: element.scrollTop,
      followingLatest: getIsFollowing(),
    });
  };
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
  // Message state + always-current mirror ref, synced at WRITE time. The
  // dictate-and-submit commit is rAF-deferred and can fire before React
  // flushes the render that carries the appended transcript — a ref synced in
  // the render body would still hold the pre-transcript text at that point,
  // so the send would go out empty (and silently no-op), leaving the
  // transcript sitting in the composer unsent. See use-composer-message-state.
  //
  // The text lives in a store rather than this hook's state: this hook owns
  // the whole chat runtime, so state here re-rendered the provider and every
  // runtime consumer (root chrome, sidebars, bridges) on each keystroke. Only
  // the composer leaf subscribes to the text; this hook reads derived facts.
  const {
    store: composerMessageStore,
    setMessage,
    messageRef: latestMessageRef,
  } = useComposerMessageStore();
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
  const scrollMemoryByConversationRef = useRef(
    new Map<string, TabScrollMemory>(),
  );
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const previousComposerConversationIdRef = useRef<string | null>(
    activeConversationId,
  );
  const restoredConversationScrollRef = useRef<string | null>(null);
  const [settledScrollConversationId, setSettledScrollConversationId] =
    useState<string | null>(null);
  const markScrollSettled = useCallback((conversationId: string | null) => {
    setSettledScrollConversationId((current) =>
      current === conversationId ? current : conversationId,
    );
  }, []);
  // Text the onboarding hand-off asked to submit as soon as the composer can.
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
    scrollMemoryByConversationRef.current.clear();
    previousComposerConversationIdRef.current = null;
    restoredConversationScrollRef.current = null;
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
            message: latestMessageRef.current,
            chatContext,
            selectedText,
          },
        );
      }
    }
    if (activeConversationId) {
      const remembered =
        composerMemoryByConversationRef.current.get(activeConversationId);
      // First-run onboarding can leave a draft for the first conversation:
      // the starter the user tapped, or what they typed to skip ahead. It
      // never overrides a tab's own remembered text.
      const pendingDraft = remembered?.message
        ? null
        : takePendingComposerDraft();
      // Arm the hand-off before writing the text so the auto-send readiness
      // subscription below observes both in the same store notification.
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
    latestMessageRef,
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
            scrollMemoryByConversationRef.current.delete(conversationId);
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
  // A conversation shows one record: the journal for one stored in the
  // cloud, the chat log for one kept on this computer. Pi adds only what
  // that record does not hold yet, so a model pick never changes what the
  // chat, Activity or Files show.
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
  // Cloud placement can acknowledge IPC before its journal reaches this
  // window. Keep pending sends working until canonical history takes over,
  // and retire their overlays even when no SQLite write occurs on this device.
  useEffect(() => {
    acknowledgeLocalMessages(persistedMessages);
  }, [acknowledgeLocalMessages, persistedMessages, localOptimisticEvents]);
  const awaitingMessageAdmission = useMemo(() => {
    const persistedIds = acceptedUserMessageIds(persistedMessages);
    return localOptimisticEvents.some(
      (event) => event.type === "user_message" && !persistedIds.has(event._id),
    );
  }, [localOptimisticEvents, persistedMessages]);
  // Activity and Files read the same record plus the agents pi ran in this
  // conversation (pi's agents keep their lifecycle in its transcript), and a
  // cloud conversation's Files also take the links in its replies, as the
  // chat log's do for one kept on this computer.
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
  const awaitingTurnHandoff = useTurnHandoff({
    conversationId: activeConversationId,
    optimisticEvents: localOptimisticEvents,
    persistedMessages,
    awaitingAdmission: awaitingMessageAdmission,
    turnRunning: piChat.isStreaming,
  });
  const isStreaming =
    piChat.isStreaming || awaitingMessageAdmission || awaitingTurnHandoff;
  // The committed reply hands off before the terminal turn frame arrives.
  const answerLanded = !awaitingMessageAdmission && piChat.answerLanded;
  // The sent bubble pops in on the frame it first paints, so its id comes from
  // the send itself, not from pi starting the turn a few frames later.
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
  // Page only the selected history; local and cloud cursors never mix.
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
  // Older replies' files come with the record's older pages.
  const hasOlderFiles = isPrivateChat
    ? localFileFeed.hasOlderFiles
    : cloudChat.conversation.state.hasOlder;
  const isLoadingOlderFiles = isPrivateChat
    ? localFileFeed.isLoadingOlder
    : cloudChat.conversation.state.loadingOlder;
  const loadOlderFiles = isPrivateChat
    ? localFileFeed.loadOlder
    : cloudChat.conversation.loadOlder;
  // Visible chat timeline: SQLite-backed `persistedMessages` plus the
  // synthetic overlays (optimistic users, in-memory streaming
  // assistants, scheduler-pending) that drop off as their persisted
  // counterparts land. Lives in its own hook so the overlay-
  // composition concerns stay next to each other.
  const displayMessages = useConversationDisplayMessages({
    conversationId: activeConversationId,
    persistedMessages,
    optimisticEvents,
    streamingAssistants: NO_STREAMING_ASSISTANTS,
  });
  const hasMessages = displayMessages.length > 0;
  const conversationAsks = useConversationUserAsks(activeConversationId);
  const hasOpenQuestion = conversationAsks.some(
    (ask) => ask.detail.kind === "question",
  );
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
  // Focus the composer on mount and whenever the user navigates onto the
  // chat route (covers both home content and the full chat surface), so
  // the user can start typing without clicking first.
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
  /**
   * Scroll: backed by Legend List (web entry). The list owns scrolling
   * and content geometry; the hook adapts list state into the surface
   * UI concerns (at-bottom, custom thumb, scroll-to-bottom button).
   */
  const {
    listRef,
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
  useLayoutEffect(() => {
    const conversationId = activeConversationId;
    const scrollMemory = scrollMemoryByConversationRef.current;
    return createConversationScrollMemoryCleanup({
      conversationId,
      list: listRef.current,
      scrollMemory,
      getIsFollowing,
      isConversationOpen: (id: string) =>
        conversationTabs
          .getSnapshot()
          .tabs.some((tab) => tab.conversationId === id),
    });
  }, [activeConversationId, getIsFollowing, listRef]);
  useEffect(() => {
    if (
      !activeConversationId ||
      isInitialLoadingMessages ||
      displayMessages.length === 0 ||
      restoredConversationScrollRef.current === activeConversationId
    ) {
      if (restoredConversationScrollRef.current === activeConversationId) {
        markScrollSettled(activeConversationId);
      }
      return;
    }
    const conversationId = activeConversationId;
    let settleRaf: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      const remembered =
        scrollMemoryByConversationRef.current.get(conversationId);
      const element = listRef.current?.getScrollableNode();
      if (remembered && !remembered.followingLatest && element) {
        const maximumScrollTop = Math.max(
          0,
          element.scrollHeight - element.clientHeight,
        );
        element.scrollTo({
          top: Math.min(remembered.scrollTop, maximumScrollTop),
          behavior: "instant",
        });
        markScrollSettled(conversationId);
      } else {
        scrollToBottom("instant");
        // Agent cards, activity cards, and images near the bottom can
        // mount/settle a beat AFTER this initial pin, growing the scroll
        // height so the "bottom" we just landed on is now above the real
        // one — tab switches that land slightly above the true bottom.
        // Keep re-pinning to the end through that post-open settling
        // (until the height stops changing, a short window elapses, or
        // the user takes over) so we always end at the actual bottom.
        //
        // The timeline stays hidden (`isOpeningScroll`) until the height has
        // held still for a few frames, so a reload or relaunch shows the
        // chat already at the bottom instead of drawing it at the top and
        // then scrolling down.
        let lastHeight = element ? element.scrollHeight : 0;
        let stableFrames = 0;
        const deadline = performance.now() + OPEN_BOTTOM_SETTLE_MS;
        const settle = () => {
          settleRaf = null;
          const node = listRef.current?.getScrollableNode();
          // Bail once the user has scrolled away — never yank them back.
          if (!node || !getIsFollowing()) {
            markScrollSettled(conversationId);
            return;
          }
          if (node.scrollHeight !== lastHeight) {
            lastHeight = node.scrollHeight;
            stableFrames = 0;
            void listRef.current?.scrollToEnd({ animated: false });
          } else if (++stableFrames === OPEN_BOTTOM_STABLE_FRAMES) {
            markScrollSettled(conversationId);
          }
          if (performance.now() < deadline) {
            settleRaf = window.requestAnimationFrame(settle);
          } else {
            markScrollSettled(conversationId);
          }
        };
        settleRaf = window.requestAnimationFrame(settle);
      }
      restoredConversationScrollRef.current = conversationId;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (settleRaf !== null) window.cancelAnimationFrame(settleRaf);
    };
  }, [
    activeConversationId,
    displayMessages.length,
    getIsFollowing,
    isInitialLoadingMessages,
    listRef,
    markScrollSettled,
    scrollToBottom,
  ]);
  const isOpeningScroll =
    Boolean(activeConversationId) &&
    displayMessages.length > 0 &&
    settledScrollConversationId !== activeConversationId;
  const handleSend = useCallback(async () => {
    // Follow the send to the bottom whenever the freshest turn is on
    // screen — near/at bottom OR meaningfully scrolled up but still within
    // the 300px send gate. `getIsEffectivelyAtBottom` is distance-based
    // (latch-independent), so a stray upward nudge near the bottom still
    // follows. Only a genuine read-history position (neither) stays put.
    //
    // While a stream is already in flight, the send queues as a follow-up
    // chip at the keyed tail of the event list (not yet a sent user row).
    // That item is the end of content too, so the same follow frames it.
    const shouldFollowSend =
      showHomeContent || getIsEffectivelyAtBottom() || getShouldFollowSend();
    const submittedConversationId = activeConversationId;
    const submittedMessage = latestMessageRef.current;
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
        // Follow the optimistic row before runtime acceptance. Waiting for
        // sendMessage here makes the viewport lag behind the visible message.
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
          submittedFromHome && !latestMessageRef.current;
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
    latestMessageRef,
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
  // Submit the onboarding hand-off once the composer is live with that exact
  // text. A rejected send restores the text through the normal path, so the
  // user still sees their draft rather than losing it.
  const autoSendDraftReady = useComposerMessageSelector(
    composerMessageStore,
    (text) =>
      pendingAutoSendTextRef.current !== null &&
      text === pendingAutoSendTextRef.current,
  );
  useEffect(() => {
    const text = pendingAutoSendTextRef.current;
    if (!text || !canSubmit || isStreaming) return;
    if (latestMessageRef.current !== text) return;
    pendingAutoSendTextRef.current = null;
    void handleSend();
  }, [
    autoSendDraftReady,
    canSubmit,
    handleSend,
    isStreaming,
    latestMessageRef,
  ]);
  const chatColumnConversation = useMemo(
    () => ({
      conversationId: activeConversationId,
      tasks,
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
      },
    }),
    [
      activeConversationId,
      activities,
      cloudChat.extraTail,
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
      listRef,
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
      listRef,
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
  // The visible message timeline (`displayMessages`) is the only field
  // that changes whenever a provider chunk arrives while a reply streams. It is
  // returned separately and published through `ChatMessagesContext` rather
  // than folded into `runtime`, so the `runtime` value below keeps a stable
  // identity across streamed chunks. That stops every `useChatRuntime()`
  // consumer (shell chrome, left sidebar, mobile bridge) from re-rendering
  // per chunk — only the timeline renderers subscribe to the message channel.
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
