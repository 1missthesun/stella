import type { ReplyRef } from "@stella/contracts/reply-refs";
import { agentIdsOf, type AgentLabelRow } from "@stella/contracts/agent-labels";
import {
  isPlacementThreadId,
  placementAliases,
} from "@stella/contracts/placement-thread-id";
import { ReplyViewer, type AgentReplyRef } from "./ReplyViewer";
import { AgentReportPopover } from "./AgentReportPopover";
import type { ReportAnchor } from "./AgentReport";
import { type ReplyAgentStatus } from "./ReplyPreview";
import {
  createMobileReplyContexts,
  type MobileReplyContexts,
} from "../lib/mobile-reply-context";
import { useAgentReplyTitles } from "../lib/use-agent-reply-titles";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsFocused } from "expo-router";
import {
  Alert,
  type GestureResponderEvent,
  Keyboard,
  LayoutChangeEvent,
  LayoutAnimation,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Text } from "./Text";
import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import {
  CHAT_ATTACHMENT_MAX_COUNT,
  driveFileNameFor,
  type ComposerAttachment,
  type PickedAttachment,
} from "../lib/chat-attachments";
import { useT } from "../i18n";
import {
  useChatDraftSelector,
  type ChatDraftStore,
} from "../lib/chat-draft-store";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AddContextSheet } from "./AddContextSheet";
import { Icon } from "./Icon";
import {
  readReceipt,
  timestampHeaders,
} from "../lib/message-time-labels";
import {
  MessageContextMenu,
  type MessageMenuAction,
} from "./MessageContextMenu";
import { AppBackdrop } from "./AppBackdrop";
import { useShellTopInset } from "./MainScreenSurface";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import type { UserAskRecord } from "@stella/contracts/user-ask-deck";
import {
  useConversationUserAskRecords,
  useConversationUserAsks,
} from "../lib/user-asks";
import {
  ChatListRow,
  createChatRowEnvStore,
  INLINE_ASK_RECORD_PREFIX,
  type ChatRowEnv,
} from "./chat/ChatListRow";
import {
  ASSISTANT_ROW_PAD_VERTICAL,
  ChatMessageRow,
  messageCompletionQuotes,
  MessageEntry,
  createCompletionQuoteCarry,
  makeMessageRowStyles,
  type MessageMenuRequest,
  type MessageRowActions,
} from "./chat/MessageRow";
import {
  CHAT_HORIZONTAL_INSET,
  Composer,
  type ComposerModelPickerConfig,
  LAYOUT_SPRING,
  draftHasText,
  isDraftEmpty,
} from "./chat/Composer";
import { CatchUpPill, ScrollToBottomFab } from "./chat/FloatingControls";
import {
  SummaryPill,
  SummaryPopover,
  useConversationSummaries,
} from "./chat/ConversationSummary";
import type { CatchUpLink } from "@stella/contracts/backend/catch-ups";
import { CATCH_UP_ENABLED, CATCH_UP_MIN_NEW_MESSAGES } from "@stella/contracts/catch-up";
import {
  type AnchorRect,
  type PlusMenuOption,
  PlusMenuPopover,
} from "./chat/PlusMenu";
import { ChatSearchResults, useChatSearchResults } from "./chat/Search";
import { stellaFileChatArtifact } from "../lib/stella-file-links";
import { useCatchUpIndicatorVisible } from "../lib/catch-up-indicator";
import { ChatHistoryPaging } from "../lib/chat-history-paging";
import {
  createVisibleChatMessages,
  isStandInArtifactRow,
  markPrependedMessagesSeen,
} from "../lib/message-row-identity";
import { SHOW_AGENT_CARDS } from "../lib/agent-cards";
import { RealtimeVoiceOverlay } from "./RealtimeVoiceOverlay";
import {
  getVoiceEnabled,
  subscribeVoiceEnabled,
} from "../lib/voice-visibility";
import { ensureMicrophonePermission } from "../lib/microphone-permission";
import {
  WorkingIndicator,
  WORKING_INDICATOR_SLOT_HEIGHT,
} from "./WorkingIndicator";
import type { WorkingIndicatorState } from "./working-indicator-state";
import {
  createReplyHandoffController,
  ReplyHandoffContext,
} from "./reply-handoff";
import { useDictation } from "../lib/dictation";
import { useServerFeatures } from "../lib/server-features";
import { hasAiConsent, requestAiConsent } from "../lib/ai-consent";
import type { RealtimeVoiceActionDispatch } from "../lib/realtime-voice-protocol";
import type { StoredPhoneAccess } from "../lib/phone-access";
import { useChatSearch } from "../lib/chat-search";
import { canStartPostSendPlacement } from "../lib/chat-post-send-placement";
import { resolveChatDataChangeScrollOwner } from "../lib/chat-scroll-ownership";
import { useChatScroll } from "../lib/use-chat-scroll";
import { refreshLinkedWorkspaceApps } from "../lib/workspace-app-links";
import { useKeyboardInset } from "../lib/use-keyboard-inset";
import { notifySuccess, tapMedium, tapLight } from "../lib/haptics";
import {
  pauseReadAloud,
  resumeReadAloud,
  speakReply,
  stopReadAloud,
  startAfterStoppingReadAloud,
  getReadAloudPlaybackState,
  useReadAloudPreference,
} from "../lib/read-aloud";
import { CONTENT_MAX_FONT_SCALE } from "../lib/font-scale";
import { type Colors } from "../theme/colors";
import { useColors } from "../theme/theme-context";
import { fonts } from "../theme/fonts";
import type {
  ChatArtifact,
  ChatMessage,
  ComposerQuote,
  MobileTask,
} from "../types";

const EDGE_FADE = 48;
const LIST_TOP_GAP = 84;
const TOP_TAPER_TAIL = 24;
const CATCH_UP_PILL_GAP = 10;
const ASK_TOP_GAP = 12;
/** Rows appended at once beyond which an arrival counts as a catch-up. */
const CATCH_UP_APPENDED_ROWS = 3;

/** True when at least CATCH_UP_APPENDED_ROWS rows follow the previous tail. */
function isCatchUpAppend(
  messages: readonly ChatMessage[],
  previousTailId: string,
): boolean {
  const last = messages.length - 1;
  for (let back = 0; back < CATCH_UP_APPENDED_ROWS; back += 1) {
    if (messages[last - back]?.id === previousTailId) return false;
  }
  return true;
}

const LEGEND_TAIL_SCROLL_AT_END = {
  animated: false,
  on: { dataChange: true, itemLayout: false, layout: false },
} as const;
const MESSAGE_LIST_GAP = 10;
const CHAT_TAIL_GAP = WORKING_INDICATOR_SLOT_HEIGHT + 12;
const FLOATING_CONTROL_GAP = 4;
const SHELL_CONTENT_PADDING = 20;

const copyMessageText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  void Clipboard.setStringAsync(trimmed).then((ok) => {
    if (ok) notifySuccess();
  });
};

const shareMessageText = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return;
  void Share.share({ message: trimmed }).catch(() => {});
};

const quoteMessageText = (text: string): string =>
  text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

const speakAloudMenuAction = (
  text: string,
  messageId: string,
): MessageMenuAction => {
  const playback = getReadAloudPlaybackState();
  const status = playback?.messageId === messageId ? playback.status : null;
  if (status === "playing") {
    return {
      id: "speak",
      label: "Pause speaking",
      icon: "pause",
      onSelect: () => {
        tapLight();
        pauseReadAloud();
      },
    };
  }
  if (status === "paused") {
    return {
      id: "speak",
      label: "Resume speaking",
      icon: "play",
      onSelect: () => {
        tapLight();
        resumeReadAloud();
      },
    };
  }
  if (status === "loading") {
    return {
      id: "speak",
      label: "Stop speaking",
      icon: "stop",
      onSelect: () => {
        tapLight();
        stopReadAloud();
      },
    };
  }
  return {
    id: "speak",
    label: "Speak aloud",
    icon: "volume-2",
    onSelect: () => {
      tapLight();
      void speakReply(text, messageId);
    },
  };
};

export type ChatPaneHistory = {
  loading?: boolean;
  hasOlder?: boolean;
  hasNewer?: boolean;
  pageLoading?: boolean;
  onLoadOlder?: () => Promise<void> | void;
  onLoadNewer?: () => Promise<void> | void;
};

export type ChatPaneComposer = {
  draftStore: ChatDraftStore;
  enabled?: boolean;
  modelPicker?: ComposerModelPickerConfig;
  placeholder: string;
  intervention?: ReactNode;
  sendReady: boolean;
  onSubmit: () => { userMessageId: string } | null;
  onStop?: () => void;
};

export type ChatPaneAttachments = {
  items?: ComposerAttachment[];
  onAdd?: (picked: readonly PickedAttachment[]) => {
    rejected: number;
  };
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  max?: number;
};

export type ChatPaneQuotes = {
  items?: ComposerQuote[];
  onAdd?: (text: string) => void;
  onRemove?: (id: string) => void;
};

export type ChatPaneRealtimeVoice = {
  conversationId?: string | null;
  execution?: "phone" | "computer";
  desktopAccess?: StoredPhoneAccess | null;
  signInRequired?: boolean;
  onAction?: (request: string) => Promise<RealtimeVoiceActionDispatch>;
};

export type ChatPaneProps = {
  messages: ChatMessage[];
  streaming: boolean;
  workingIndicator?: WorkingIndicatorState;
  offline?: boolean;
  emptyContent: ReactNode;
  history?: ChatPaneHistory;
  composer: ChatPaneComposer;
  attachments?: ChatPaneAttachments;
  quotes?: ChatPaneQuotes;
  realtimeVoice?: ChatPaneRealtimeVoice;
  desktopAccess?: StoredPhoneAccess | null;

  onOpenArtifact?: (
    artifact: ChatArtifact,
    gallery?: readonly ChatArtifact[],
  ) => void;

  conversationId?: string | null;

  activityTasks?: MobileTask[];

  onOpenActivity?: () => void;

  topInset?: number;

  catchingUp?: boolean;
  onFooterHeightChange?: (height: number) => void;
};

const NO_HISTORY: ChatPaneHistory = {};
const NO_ATTACHMENTS: ChatPaneAttachments = {};
const NO_QUOTES: ChatPaneQuotes = {};
const NO_REALTIME_VOICE: ChatPaneRealtimeVoice = {};


const askRecordSignature = (record: UserAskRecord): string =>
  record.answers.map((answer) => answer.question).join("\u0000");

const withInlineAskRecords = (
  messages: ChatMessage[],
  sessionRecords: readonly UserAskRecord[],
): ChatMessage[] => {
  if (sessionRecords.length === 0) return messages;
  const shown = new Set<string>();
  for (const message of messages) {
    for (const record of message.askRecords ?? []) {
      shown.add(record.toolCallId ?? record.id);
      shown.add(askRecordSignature(record));
    }
  }
  const out = [...messages];
  for (const record of sessionRecords) {
    if (shown.has(record.toolCallId ?? record.id) || shown.has(askRecordSignature(record))) {
      continue;
    }
    const item: ChatMessage = {
      id: `${INLINE_ASK_RECORD_PREFIX}${record.id}`,
      role: "assistant",
      text: "",
      createdAt: record.createdAt,
      askRecords: [record],
    };
    const before = out.findIndex(
      (message) =>
        (message.canonicalCreatedAt ?? message.createdAt ?? Number.POSITIVE_INFINITY) >
        record.createdAt,
    );
    if (before < 0) out.push(item);
    else out.splice(before, 0, item);
  }
  return out;
};

const REPLY_PLACEMENT_PIN_SUPPRESS_MS = 1500;

const keepEveryRow = () => false;

const agentLabelRows = new WeakMap<
  ChatMessage,
  { context: ReplyRef | undefined; row: AgentLabelRow }
>();

const agentLabelRow = (
  message: ChatMessage,
  context: ReplyRef | undefined,
): AgentLabelRow => {
  const cached = agentLabelRows.get(message);
  if (cached && cached.context === context) return cached.row;
  let row: AgentLabelRow;
  if (message.role !== "assistant") {
    row = { id: message.id, role: "user" };
  } else {
    const agentIds = messageCompletionQuotes(message).map(
      (quote) => quote.ref.threadId,
    );
    if (context?.kind === "agent") agentIds.push(context.threadId);
    row = {
      id: message.id,
      role: "assistant",
      ...(agentIds.length ? { agentIds } : {}),
    };
  }
  agentLabelRows.set(message, { context, row });
  return row;
};

/**
 * The rows whose agent chip is hidden because the row before already names
 * that agent (`projectAgentLabels`), for a transcript that changes mostly at
 * its end: the label fold resumes after the unchanged rows unless a new
 * placement alias renames an agent an earlier row shows.
 */
const createHiddenAgentChips = () => {
  let previous: {
    messages: readonly ChatMessage[];
    contexts: ReadonlyMap<string, ReplyRef>;
    rows: AgentLabelRow[];
    contextAt: (ReplyRef | undefined)[];
    ids: string[];
    idSet: Set<string>;
    aliases: Map<string, string>;
    current: (string | null)[];
    labels: (string[] | undefined)[];
    result: Set<string>;
  } | null = null;
  return (
    messages: readonly ChatMessage[],
    contexts: ReadonlyMap<string, ReplyRef>,
  ): Set<string> => {
    let kept = 0;
    if (previous) {
      const shared = Math.min(messages.length, previous.messages.length);
      while (kept < shared && messages[kept] === previous.messages[kept]) kept += 1;
      if (previous.contexts !== contexts) {
        for (let at = 0; at < kept; at += 1) {
          const message = messages[at]!;
          if (message.role !== "assistant") continue;
          if (contexts.get(message.id) !== previous.contextAt[at]) {
            kept = at;
            break;
          }
        }
      }
      if (kept === messages.length && kept === previous.messages.length) {
        previous.contexts = contexts;
        return previous.result;
      }
    }
    const rows = previous ? previous.rows.slice(0, kept) : [];
    const contextAt = previous ? previous.contextAt.slice(0, kept) : [];
    for (let at = kept; at < messages.length; at += 1) {
      const message = messages[at]!;
      const context = contexts.get(message.id);
      contextAt.push(context);
      rows.push(agentLabelRow(message, context));
    }
    let ids: string[];
    let idSet: Set<string>;
    if (previous && kept === previous.messages.length) {
      ids = previous.ids.slice();
      idSet = new Set(previous.idSet);
      for (let at = kept; at < rows.length; at += 1) {
        for (const id of rows[at]!.agentIds ?? []) {
          if (idSet.has(id)) continue;
          idSet.add(id);
          ids.push(id);
        }
      }
    } else {
      ids = agentIdsOf(rows);
      idSet = new Set(ids);
    }
    const aliases = placementAliases(ids);
    let resume = kept;
    if (previous) {
      for (const [alias, id] of aliases) {
        if (previous.aliases.get(alias) === id) continue;
        if (previous.idSet.has(alias)) {
          resume = 0;
          break;
        }
      }
      for (const alias of previous.aliases.keys()) {
        if (!aliases.has(alias) && previous.idSet.has(alias)) {
          resume = 0;
          break;
        }
      }
    }
    const canonical = (id: string) =>
      isPlacementThreadId(id) ? (aliases.get(id) ?? id) : id;
    const current = previous ? previous.current.slice(0, resume) : [];
    const labels = previous ? previous.labels.slice(0, resume) : [];
    let carried = resume > 0 ? current[resume - 1]! : null;
    for (let at = resume; at < rows.length; at += 1) {
      const row = rows[at]!;
      let label: string[] | undefined;
      if (!row.hidden && row.role === "assistant" && row.agentIds?.length) {
        const seen = new Set<string>();
        const fresh: string[] = [];
        for (const raw of row.agentIds) {
          const id = canonical(raw);
          if (seen.has(id)) continue;
          seen.add(id);
          if (id !== carried) fresh.push(raw);
        }
        if (fresh.length > 0) {
          label = fresh;
          carried = canonical(fresh[fresh.length - 1]!);
        }
      }
      labels.push(label);
      current.push(carried);
    }
    const labeled = new Set<string>();
    labels.forEach((label, at) => {
      if (label) labeled.add(rows[at]!.id);
    });
    const result = new Set<string>();
    for (const row of rows) {
      if (row.agentIds?.length && !labeled.has(row.id)) result.add(row.id);
    }
    previous = { messages, contexts, rows, contextAt, ids, idSet, aliases, current, labels, result };
    return result;
  };
};

export function ChatPane({
  messages: projectedMessages,
  streaming,
  workingIndicator,
  offline = false,
  emptyContent,
  history = NO_HISTORY,
  composer,
  attachments: attachmentsGroup,
  quotes: quotesGroup = NO_QUOTES,
  realtimeVoice = NO_REALTIME_VOICE,
  desktopAccess: desktopAccessProp = null,
  onOpenArtifact,
  conversationId = null,
  activityTasks,
  onOpenActivity,
  catchingUp = false,
  topInset: topInsetProp,
  onFooterHeightChange,
}: ChatPaneProps) {
  const {
    loading: historyLoading = false,
    hasOlder: hasOlderHistory = false,
    hasNewer: hasNewerHistory = false,
    pageLoading: historyPageLoading = false,
    onLoadOlder: onLoadOlderHistory,
    onLoadNewer: onLoadNewerHistory,
  } = history;
  const {
    draftStore,
    enabled: composerEnabled = true,
    modelPicker: composerModelPicker,
    placeholder,
    intervention: composerIntervention,
    sendReady,
    onSubmit,
    onStop,
  } = composer;
  const enableAttachments = attachmentsGroup !== undefined;
  const {
    items: attachments,
    onAdd: onAddAttachments,
    onRemove: onRemoveAttachment,
    onRetry: onRetryAttachment,
    max: maxAttachments,
  } = attachmentsGroup ?? NO_ATTACHMENTS;
  const {
    items: quotes,
    onAdd: onAddQuote,
    onRemove: onRemoveQuote,
  } = quotesGroup;
  const {
    conversationId: realtimeVoiceConversationId = null,
    execution: realtimeVoiceExecution = "phone",
    desktopAccess: realtimeVoiceDesktopAccess = null,
    signInRequired: realtimeVoiceSignInRequired = false,
    onAction: onRealtimeVoiceAction,
  } = realtimeVoice;
  const desktopAccess = desktopAccessProp ?? realtimeVoiceDesktopAccess;
  const messages = useAgentReplyTitles(conversationId, projectedMessages);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  const serverFeatures = useServerFeatures();
  const readAloudPreference = useReadAloudPreference();
  const readAloud = serverFeatures.readAloud
    ? readAloudPreference
    : { ...readAloudPreference, enabled: false };
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom;
  const safeAreaTop = insets.top;
  const shellTopInset = useShellTopInset();
  const topInset = topInsetProp ?? shellTopInset;
  const { height: screenHeight } = useWindowDimensions();

  const inputRef = useRef<TextInput>(null);
  const { height: keyboardHeight, composerBottomPad } = useKeyboardInset();
  const keyboardHeightNow = useSharedValue(0);
  const listAtBottom = useSharedValue(1);
  const listRidesKeyboard = useSharedValue(1);
  const [listLiftedWithKeyboard, setListLiftedWithKeyboard] = useState(true);
  useKeyboardHandler(
    {
      onStart: (e) => {
        "worklet";
        if (keyboardHeightNow.value < 1 && e.height > 0) {
          const rides = listAtBottom.value;
          if (rides !== listRidesKeyboard.value) {
            listRidesKeyboard.value = rides;
            runOnJS(setListLiftedWithKeyboard)(rides === 1);
          }
        }
        if (e.duration === 0) keyboardHeightNow.value = e.height;
      },
      onMove: (e) => {
        "worklet";
        keyboardHeightNow.value = e.height;
      },
      onInteractive: (e) => {
        "worklet";
        keyboardHeightNow.value = e.height;
      },
      onEnd: (e) => {
        "worklet";
        keyboardHeightNow.value = e.height;
      },
    },
    [],
  );
  const keyboardLift = useDerivedValue(() =>
    Math.max(0, keyboardHeightNow.value - bottomInset),
  );
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboardLift.value }],
  }));
  const listKeyboardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -keyboardLift.value * listRidesKeyboard.value },
    ],
  }));
  const keyboardExtra = Math.max(0, keyboardHeight - bottomInset);

  const [footerHeight, setFooterHeight] = useState(0);
  const [replyHandoffController] = useState(
    createReplyHandoffController,
  );
  const listBottomInsetPx =
    footerHeight + (listLiftedWithKeyboard ? 0 : keyboardExtra);

  const listTrailingSlackPx = listBottomInsetPx + CHAT_TAIL_GAP;

  const onFooterLayout = useCallback((e: LayoutChangeEvent) => {
    setFooterHeight(Math.round(e.nativeEvent.layout.height));
  }, []);
  useEffect(() => {
    onFooterHeightChange?.(footerHeight);
  }, [footerHeight, onFooterHeightChange]);

  const assistantTextLenRef = useRef(0);
  const assistantIdRef = useRef<string | null>(null);
  const [projectReplyContexts] = useState(createMobileReplyContexts);
  const replyContexts = useMemo(
    () => projectReplyContexts(messages),
    [messages, projectReplyContexts],
  );
  const [filterVisibleMessages] = useState(createVisibleChatMessages);
  const visibleMessages = useMemo(
    () =>
      filterVisibleMessages(messages, {
        contextMessageIds: replyContexts.contexts,
        canOpenArtifacts: Boolean(onOpenArtifact),
      }),
    [filterVisibleMessages, messages, replyContexts, onOpenArtifact],
  );
  const [carryQuotes] = useState(createCompletionQuoteCarry);
  const quoteCarry = useMemo(
    () =>
      SHOW_AGENT_CARDS
        ? carryQuotes(visibleMessages, keepEveryRow)
        : carryQuotes(messages, isStandInArtifactRow),
    [carryQuotes, messages, visibleMessages],
  );
  const { questions: openQuestionAsks, secureInput: openSecureAsk } =
    useConversationUserAsks(conversationId);
  const sessionAskRecords = useConversationUserAskRecords(conversationId);
  const listMessages = useMemo(
    () => withInlineAskRecords(visibleMessages, sessionAskRecords),
    [sessionAskRecords, visibleMessages],
  );
  const [hiddenAgentChips] = useState(createHiddenAgentChips);
  const hiddenAgentChipIds = useMemo(
    () => hiddenAgentChips(listMessages, replyContexts.contexts),
    [hiddenAgentChips, listMessages, replyContexts],
  );
  const askActive = openQuestionAsks.length > 0 || openSecureAsk !== null;
  const [askCollapsed, setAskCollapsed] = useState(false);
  const askActiveRef = useRef(askActive);
  askActiveRef.current = askActive;
  const askCollapsedRef = useRef(askCollapsed);
  askCollapsedRef.current = askCollapsed;
  useEffect(() => {
    if (!askActive) setAskCollapsed(false);
  }, [askActive]);
  const expandAsk = useCallback(() => {
    tapLight();
    inputRef.current?.blur();
    LayoutAnimation.configureNext(LAYOUT_SPRING);
    setAskCollapsed(false);
  }, []);
  const [paneHeight, setPaneHeight] = useState(0);
  const onPaneLayout = useCallback((e: LayoutChangeEvent) => {
    setPaneHeight(Math.round(e.nativeEvent.layout.height));
  }, []);
  // A conversation first observed empty mounts its list on the optimistic
  // send. Our post-send owner already places that row; starting Legend's
  // footer-preserving end bootstrap as well would move it a second time.
  // Existing history still bootstraps at its tail once hydration completes.
  const initialScrollAtEndRef = useRef<boolean | null>(null);
  if (!historyLoading && initialScrollAtEndRef.current === null) {
    initialScrollAtEndRef.current = visibleMessages.length > 0;
  }
  const [replyFocus, setReplyFocus] = useState<ReplyRef | null>(null);
  const [openReport, setOpenReport] = useState<{
    refs: readonly AgentReplyRef[];
    anchor: ReportAnchor | null;
  } | null>(null);
  const showReport = useCallback(
    (refs: readonly AgentReplyRef[], anchor?: ReportAnchor) =>
      setOpenReport({ refs, anchor: anchor ?? null }),
    [],
  );
  const closeReplyFocus = useCallback(() => setReplyFocus(null), []);
  const closeReport = useCallback(() => setOpenReport(null), []);
  const openReportJournal = openReport
    ? Object.fromEntries(
        openReport.refs.map((ref) => {
          const task = activityTasks?.find((candidate) => candidate.id === ref.threadId);
          return [ref.threadId, task?.resultText ?? task?.errorMessage];
        }),
      )
    : undefined;
  useEffect(() => {
    setReplyFocus(null);
    setOpenReport(null);
  }, [conversationId]);
  const contextStatusFor = useCallback(
    (
      contexts: MobileReplyContexts,
      ref: ReplyRef | undefined,
    ): ReplyAgentStatus | undefined =>
      ref?.kind === "agent"
        ? contexts.agentStates.get(ref.threadId)
        : undefined,
    [],
  );
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const scroll = useChatScroll(
    listTrailingSlackPx,
    lastMessage?.id ?? null,
    topInset,
  );

  useEffect(() => {
    listAtBottom.value = scroll.awayFromBottom ? 0 : 1;
  }, [listAtBottom, scroll.awayFromBottom]);

  const [unread, setUnread] = useState(false);
  const prevLenRef = useRef(0);
  const sawTurnRef = useRef(false);
  const spokenAssistantIdsRef = useRef<Set<string>>(new Set());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const headMessageIdRef = useRef<string | null>(null);
  headMessageIdRef.current = markPrependedMessagesSeen(
    seenMessageIdsRef.current,
    visibleMessages,
    headMessageIdRef.current,
  );

  if (lastMessage?.role === "assistant") {
    const isNewAssistant = lastMessage.id !== assistantIdRef.current;
    const grewText = lastMessage.text.length > assistantTextLenRef.current;
    if (isNewAssistant) {
      scroll.resetAssistantAutoScroll();
    }
    // Only engage the animated catch-up while a reply is actively streaming
    // (or pending, for the computer chat). Without this gate, hydrating saved
    // history on tab mount looks like a fresh assistant message with huge
    // "growth" (baseline=0 before the list lays out), and the follow loop
    // animates a ~400px scroll on top of the initial scrollToEnd — the chat
    // visibly readjusts every time the user switches to the tab.
    if (streaming && (isNewAssistant || grewText)) {
      scroll.prepareAssistantLayoutFollow();
    }
    assistantTextLenRef.current = lastMessage.text.length;
    assistantIdRef.current = lastMessage.id;
  } else {
    assistantTextLenRef.current = 0;
    assistantIdRef.current = null;
  }

  // Assistant identity changes reset its measurements above. A busy-state
  // transition alone must not cancel the in-flight post-send placement.

  const pendingSendNudgeRef = useRef<{
    userMessageId: string;
  } | null>(null);
  useEffect(() => {
    const pending = pendingSendNudgeRef.current;
    if (!pending) return;
    // onSubmit can return before its optimistic row reaches this list. Starting
    // placement against the previous tail discards the anchor before onLayout.
    if (
      !canStartPostSendPlacement(
        pending.userMessageId,
        visibleMessages.map((message) => message.id),
        0,
      )
    )
      return;
    pendingSendNudgeRef.current = null;
    scroll.nudgeAfterSend(pending.userMessageId);
  }, [visibleMessages, scroll.nudgeAfterSend]);

  // LegendList's `dataChange` auto-pin fires on the optimistic send append —
  // `streaming` is often still false at that render (always for a placed
  // dispatch) — and scrolls to the literal content end, fighting the custom
  // post-send nudge that owns the tail. Suppress it while a send-nudge is in
  // flight; streaming or the next appended row releases this identity latch.
  const [sendPinSuppressForId, setSendPinSuppressForId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (!sendPinSuppressForId) return;
    if (streaming || lastMessage?.id !== sendPinSuppressForId) {
      setSendPinSuppressForId(null);
    }
  }, [sendPinSuppressForId, streaming, lastMessage?.id]);

  // The landed reply whose placement owns the tail, and until when. A ref
  // rather than state: setting state from the layout effect below re-rendered
  // the whole pane synchronously, inside the frame the reply arrived in.
  const replyPinRef = useRef<{ id: string; untilMs: number } | null>(null);
  const [, setReplyPinExpiry] = useState(0);
  const settledReplyIdsRef = useRef<Set<string> | null>(null);
  const settledForConversationRef = useRef(conversationId);
  if (settledForConversationRef.current !== conversationId) {
    settledForConversationRef.current = conversationId;
    settledReplyIdsRef.current = null;
  }
  const placedReplyIdRef = useRef<string | null>(null);
  // A catch-up (reconnect, bulk history) appends many rows in one render. Its
  // newest reply lands far below the rendered window, so placing that row
  // would wait for a layout that never comes while Legend's tail pin is off,
  // leaving the list where it was. Settle it here instead: the data change
  // stays with Legend's tail pin, which keeps a reader at the bottom pinned.
  const tailTrackRef = useRef<{
    conversationId: typeof conversationId;
    id: string | null;
  }>({
    conversationId,
    id: null,
  });
  const previousTail = tailTrackRef.current;
  const previousTailId =
    previousTail.conversationId === conversationId ? previousTail.id : null;
  tailTrackRef.current = { conversationId, id: lastMessage?.id ?? null };
  if (
    lastMessage &&
    previousTailId !== null &&
    previousTailId !== lastMessage.id &&
    settledReplyIdsRef.current !== null &&
    isCatchUpAppend(visibleMessages, previousTailId)
  ) {
    for (
      let index = visibleMessages.length - 1;
      index >= 0 && visibleMessages[index]!.id !== previousTailId;
      index -= 1
    ) {
      const message = visibleMessages[index]!;
      if (message.role === "assistant" && message.text.trim().length > 0) {
        settledReplyIdsRef.current.add(message.id);
      }
    }
  }
  const lastReplyHasText =
    lastMessage?.role === "assistant" && lastMessage.text.trim().length > 0;
  const landingReplyId =
    lastMessage &&
    lastReplyHasText &&
    settledReplyIdsRef.current !== null &&
    !settledReplyIdsRef.current.has(lastMessage.id)
      ? lastMessage.id
      : null;
  const placingReplyId = landingReplyId ?? placedReplyIdRef.current;
  const {
    getShouldPlaceLatestTurn: shouldPlaceLatestTurn,
    nudgeAfterSend: placeLatestTurnFor,
  } = scroll;
  useLayoutEffect(() => {
    if (historyLoading) return;
    const settled = settledReplyIdsRef.current;
    if (settled === null) {
      settledReplyIdsRef.current = new Set(
        visibleMessages
          .filter(
            (message) =>
              message.role === "assistant" && message.text.trim().length > 0,
          )
          .map((message) => message.id),
      );
      return;
    }
    if (!lastMessage || !lastReplyHasText) return;
    if (settled.has(lastMessage.id)) return;
    settled.add(lastMessage.id);
    placedReplyIdRef.current = lastMessage.id;
    if (!shouldPlaceLatestTurn()) return;
    placeLatestTurnFor(lastMessage.id);
    replyPinRef.current = {
      id: lastMessage.id,
      untilMs: Date.now() + REPLY_PLACEMENT_PIN_SUPPRESS_MS,
    };
  }, [
    historyLoading,
    lastMessage,
    lastReplyHasText,
    placeLatestTurnFor,
    shouldPlaceLatestTurn,
    visibleMessages,
  ]);
  const replyPin = replyPinRef.current;
  const replyPinned =
    replyPin !== null &&
    replyPin.id === lastMessage?.id &&
    Date.now() < replyPin.untilMs;
  useEffect(() => {
    if (!replyPinned || !replyPin) return;
    const timer = setTimeout(
      () => setReplyPinExpiry((tick) => tick + 1),
      Math.max(0, replyPin.untilMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [replyPin, replyPinned]);

  const dataChangeScrollOwner = resolveChatDataChangeScrollOwner({
    isFollowingLatest: scroll.isFollowingLatest,
    isStreaming: streaming,
    postSendPlacementPending:
      sendPinSuppressForId !== null ||
      replyPinned ||
      landingReplyId !== null,
  });
  const scrollOwnerRef = useRef(dataChangeScrollOwner);
  scrollOwnerRef.current = dataChangeScrollOwner;
  const historyAnchored = dataChangeScrollOwner === "history-anchor";
  const maintainVisibleContentPosition = useMemo(
    () => ({
      // Legend sets the native ScrollView prop from `data || size`, so `data`
      // keeps native MVCP on for the ScrollView's lifetime while `size` moves.
      data: true,
      size: historyAnchored,
      shouldRestorePosition: () => scrollOwnerRef.current === "history-anchor",
    }),
    [historyAnchored],
  );
  useEffect(() => {
    const grew = visibleMessages.length > prevLenRef.current;
    prevLenRef.current = visibleMessages.length;
    if (visibleMessages.length === 0) {
      setUnread(false);
      return;
    }
    if (grew && scroll.awayFromBottom) setUnread(true);
  }, [visibleMessages.length, scroll.awayFromBottom]);

  useEffect(() => {
    if (!scroll.awayFromBottom) setUnread(false);
  }, [scroll.awayFromBottom]);

  useEffect(() => {
    if (!readAloud.enabled) {
      sawTurnRef.current = false;
      return;
    }
    if (streaming && !sawTurnRef.current) {
      for (const message of visibleMessages) {
        if (message.role === "assistant" && message.text.trim()) {
          spokenAssistantIdsRef.current.add(message.id);
        }
      }
      sawTurnRef.current = true;
    }
    if (!sawTurnRef.current) return;
    const latestAssistant = [...visibleMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.text.trim());
    if (
      !latestAssistant ||
      spokenAssistantIdsRef.current.has(latestAssistant.id)
    ) {
      return;
    }
    sawTurnRef.current = false;
    spokenAssistantIdsRef.current.add(latestAssistant.id);
    void speakReply(latestAssistant.text, latestAssistant.id);
  }, [visibleMessages, readAloud.enabled, streaming]);

  const wasStreamingRef = useRef(streaming);
  useEffect(() => {
    if (wasStreamingRef.current && !streaming) refreshLinkedWorkspaceApps();
    wasStreamingRef.current = streaming;
  }, [streaming]);

  const [realtimeVoiceOpen, setRealtimeVoiceOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabledLocal] = useState(() =>
    getVoiceEnabled(),
  );
  useEffect(() => subscribeVoiceEnabled(setVoiceEnabledLocal), []);
  useEffect(() => {
    if (!voiceEnabled) setRealtimeVoiceOpen(false);
  }, [voiceEnabled]);

  const draftEmpty = useChatDraftSelector(draftStore, isDraftEmpty);
  const hasText = useChatDraftSelector(draftStore, draftHasText);

  const submit = useCallback(() => {
    tapMedium();
    const shouldPlaceLatestTurn = scroll.getShouldPlaceLatestTurn();
    const submitted = onSubmit();
    if (submitted && shouldPlaceLatestTurn) {
      setSendPinSuppressForId(submitted.userMessageId);
      pendingSendNudgeRef.current = {
        userMessageId: submitted.userMessageId,
      };
    } else if (submitted) {
      scroll.releaseFollow();
    }
    Keyboard.dismiss();
  }, [
    onSubmit,
    scroll.getShouldPlaceLatestTurn,
    scroll.nudgeAfterSend,
    scroll.releaseFollow,
  ]);

  const voiceSendInFlightRef = useRef(false);
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const appendTranscript = useCallback(
    (text: string) => {
      const trimmedPrev = draftStore.get().trimEnd();
      draftStore.set(trimmedPrev ? `${trimmedPrev} ${text}` : text);
    },
    [draftStore],
  );

  const screenFocused = useIsFocused();
  const dictation = useDictation({
    onTranscript: appendTranscript,
    prewarm: screenFocused,
  });
  const prewarmDictation = dictation.prewarm;

  const {
    status: dictationStatus,
    start: startDictation,
    stop: stopDictation,
    cancel: cancelDictation,
    toggle: toggleDictation,
  } = dictation;
  const isListening = dictation.isRecording;
  const wasListeningRef = useRef(isListening);
  if (wasListeningRef.current !== isListening) {
    wasListeningRef.current = isListening;
    LayoutAnimation.configureNext(LAYOUT_SPRING);
  }

  const toggleVoice = useCallback(async () => {
    if (dictationStatus === "idle") {
      // No tap here: `useDictation` fires on the real transition, once the
      // mic is actually live. Buzzing on the press as well double-tapped the
      // start and lied whenever consent or the mic permission refused.
      // In-flight progressive TTS can otherwise apply Expo's playback audio
      // mode after recording starts. On iOS that mode stops every recorder.
      await startAfterStoppingReadAloud(() => startDictation());
      return;
    }
    await toggleDictation();
  }, [dictationStatus, startDictation, toggleDictation]);
  const cancelDictationInput = useCallback(
    () => void cancelDictation(),
    [cancelDictation],
  );
  const confirmDictationInput = useCallback(
    () => void stopDictation(),
    [stopDictation],
  );

  const realtimeVoiceOpeningRef = useRef(false);
  const openRealtimeVoice = useCallback(async () => {
    if (!getVoiceEnabled()) return;
    if (!realtimeVoiceSignInRequired && !hasAiConsent()) {
      requestAiConsent();
      return;
    }
    if (realtimeVoiceOpeningRef.current) return;
    realtimeVoiceOpeningRef.current = true;
    tapMedium();
    try {
      // Resolve microphone access before the voice screen exists. The system
      // prompt suspends the app (Android reports it as `background`), which
      // used to close a voice screen that had only just opened. An already
      // granted permission resolves silently and never shows a prompt.
      const permission = realtimeVoiceSignInRequired
        ? ({ granted: true } as const)
        : await ensureMicrophonePermission();
      if (!permission.granted) {
        Alert.alert(
          "Microphone access needed",
          permission.canAskAgain
            ? "Stella needs access to your microphone for realtime voice. You can allow it the next time the system asks."
            : "Stella needs access to your microphone for realtime voice. Turn it on in Settings → Stella → Microphone.",
          permission.canAskAgain
            ? [{ text: "OK", style: "default" }]
            : [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Open Settings",
                  style: "default",
                  onPress: () => {
                    void Linking.openSettings();
                  },
                },
              ],
        );
        return;
      }
      stopReadAloud();
      Keyboard.dismiss();
      setRealtimeVoiceOpen(true);
    } finally {
      realtimeVoiceOpeningRef.current = false;
    }
  }, [realtimeVoiceSignInRequired]);

  const performRealtimeVoiceAction = useCallback(
    async (request: string) =>
      onRealtimeVoiceAction ? onRealtimeVoiceAction(request) : null,
    [onRealtimeVoiceAction],
  );

  const stopAndSendVoice = useCallback(() => {
    if (voiceSendInFlightRef.current) return;
    voiceSendInFlightRef.current = true;
    void stopDictation()
      .then((transcript) => {
        if (transcript) submitRef.current();
      })
      .catch(() => undefined)
      .finally(() => {
        voiceSendInFlightRef.current = false;
      });
  }, [stopDictation]);

  const attachmentLimit = maxAttachments ?? CHAT_ATTACHMENT_MAX_COUNT;
  const acceptPicked = useCallback(
    (picked: readonly PickedAttachment[]) => {
      if (!onAddAttachments || picked.length === 0) return;
      tapLight();
      const { rejected } = onAddAttachments(picked);
      if (rejected > 0) {
        Alert.alert(
          t("chat.attachments.tooManyTitle"),
          t("chat.attachments.tooManyBody", { count: attachmentLimit }),
        );
      }
    },
    [attachmentLimit, onAddAttachments, t],
  );

  const imagePickAsAttachment = useCallback(
    (asset: ImagePicker.ImagePickerAsset): PickedAttachment => ({
      id: asset.assetId ?? asset.uri,
      uri: asset.uri,
      name: driveFileNameFor(asset.fileName ?? asset.uri, "image"),
      mimeType: asset.mimeType ?? "image/jpeg",
      sizeBytes: asset.fileSize ?? 0,
      kind: "image",
    }),
    [],
  );

  const pickImage = useCallback(async () => {
    if (!enableAttachments || !onAddAttachments) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        t("chat.attachments.photosDeniedTitle"),
        t("chat.attachments.photosDeniedBody"),
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.75,
      selectionLimit: attachmentLimit,
      // HEIC bypasses the picker's `quality` JPEG re-encode (raw bytes pass
      // through), and desktop model providers can't decode HEIC. Ask PhotoKit
      // for the most compatible representation so library picks arrive as
      // JPEG at the picker level.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled) {
      acceptPicked(result.assets.map(imagePickAsAttachment));
    }
  }, [
    acceptPicked,
    attachmentLimit,
    enableAttachments,
    imagePickAsAttachment,
    onAddAttachments,
    t,
  ]);

  const takePhoto = useCallback(async () => {
    if (!enableAttachments || !onAddAttachments) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        t("chat.attachments.cameraDeniedTitle"),
        t("chat.attachments.cameraDeniedBody"),
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.75,
    });
    if (!result.canceled) {
      acceptPicked(result.assets.map(imagePickAsAttachment));
    }
  }, [
    acceptPicked,
    enableAttachments,
    imagePickAsAttachment,
    onAddAttachments,
    t,
  ]);

  const pickDocument = useCallback(async () => {
    if (!enableAttachments || !onAddAttachments) return;
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      // Copied into the app's cache so the URI stays readable after the
      // picker's security-scoped access is released.
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    acceptPicked(
      result.assets.map((asset) => {
        const mimeType = asset.mimeType ?? "application/octet-stream";
        const kind = mimeType.startsWith("image/") ? "image" : "file";
        return {
          id: asset.uri,
          uri: asset.uri,
          name: driveFileNameFor(asset.name, kind),
          mimeType,
          sizeBytes: asset.size ?? 0,
          kind,
        };
      }),
    );
  }, [acceptPicked, enableAttachments, onAddAttachments]);

  const rootRef = useRef<View>(null);
  const modelPickerAnchorRef = useRef<View>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  // The picker a sheet choice asked for; it opens once the sheet is gone,
  // since iOS won't present a picker over a sheet that is still leaving.
  const afterAddSheetRef = useRef<(() => void) | null>(null);
  const [modelPickerAnchor, setModelPickerAnchor] = useState<AnchorRect | null>(
    null,
  );

  const chooseFromAddSheet = useCallback((action: () => void) => {
    afterAddSheetRef.current = action;
    setAddSheetOpen(false);
  }, []);
  const onAddSheetDismissed = useCallback(() => {
    const action = afterAddSheetRef.current;
    afterAddSheetRef.current = null;
    action?.();
  }, []);

  const catchUpVisible = useCatchUpIndicatorVisible(catchingUp);

  const [historyPaging] = useState(() => new ChatHistoryPaging());
  const requestHistoryNearPosition = useCallback(
    ({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent) => {
      const page = historyPaging.takePage({
        conversationId,
        offsetY: contentOffset.y,
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
        hasOlder: hasOlderHistory && Boolean(onLoadOlderHistory),
        hasNewer: hasNewerHistory && Boolean(onLoadNewerHistory),
        loading: historyPageLoading,
      });
      if (page === "older") void onLoadOlderHistory?.();
      if (page === "newer") void onLoadNewerHistory?.();
    },
    [
      conversationId,
      historyPaging,
      hasOlderHistory,
      hasNewerHistory,
      historyPageLoading,
      onLoadOlderHistory,
      onLoadNewerHistory,
    ],
  );
  const handleListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scroll.onScroll(e);
      requestHistoryNearPosition(e.nativeEvent);
    },
    [scroll.onScroll, requestHistoryNearPosition],
  );
  const handleListScrollSettle = scroll.onScrollSettle;
  const handleListContentSizeChange = scroll.onListContentSizeChange;

  const onPressPlus = useCallback(() => {
    tapLight();
    Keyboard.dismiss();
    setAddSheetOpen(true);
  }, []);

  const modelPickerOptions = useMemo<PlusMenuOption[]>(() => {
    if (!composerModelPicker?.pinned) return [];
    const disabled = Boolean(composerModelPicker.loading);
    const thinkingOptions: PlusMenuOption[] =
      composerModelPicker.effortOptions.length === 0
        ? []
        : [
            {
              id: "model-thinking",
              label: t("app.chat.miniModelPicker.reasoningEffortLabel"),
              icon: "brain",
              trailingLabel: composerModelPicker.effortLabel,
              disabled: composerModelPicker.loading,
              submenuTitle: t("app.chat.miniModelPicker.reasoningEffortLabel"),
              submenu: composerModelPicker.effortOptions.map((effort) => ({
                id: `model-effort-${effort.id}`,
                label: effort.label,
                icon: "brain",
                selected: effort.selected,
                disabled,
                onSelect: () => composerModelPicker.onSelectEffort(effort.id),
              })),
              onSelect: () => undefined,
            },
          ];
    const options: PlusMenuOption[] = [
      ...thinkingOptions,
      ...composerModelPicker.recentModels.map((model) => ({
        id: `model-recent-${model.id}`,
        label: model.label,
        icon: "cpu" as const,
        selected: model.selected,
        disabled: disabled || model.selected,
        onSelect: () => composerModelPicker.onSelectModel(model.id),
      })),
    ];
    return options;
  }, [composerModelPicker, t]);

  const onPressModelPicker = useCallback(() => {
    if (!composerModelPicker?.pinned || !modelPickerAnchorRef.current) return;
    tapLight();
    composerModelPicker.onOpen();
    const measureAnchor = () => {
      modelPickerAnchorRef.current?.measureInWindow((x, y, width, height) => {
        setModelPickerAnchor({ x, y, width, height });
      });
    };
    if (Keyboard.isVisible()) {
      const sub = Keyboard.addListener("keyboardDidHide", () => {
        sub.remove();
        measureAnchor();
      });
      Keyboard.dismiss();
    } else {
      measureAnchor();
    }
  }, [composerModelPicker]);

  const dismissModelPicker = useCallback(() => setModelPickerAnchor(null), []);

  const [messageMenu, setMessageMenu] = useState<MessageMenuRequest | null>(
    null,
  );
  const [selectingMessageId, setSelectingMessageId] = useState<string | null>(
    null,
  );
  const startSelectingMessage = useCallback((id: string) => {
    setSelectingMessageId(id);
  }, []);
  const stopSelectingMessage = useCallback(() => {
    setSelectingMessageId(null);
  }, []);
  const dismissMessageMenu = useCallback(() => {
    setMessageMenu(null);
  }, []);

  const quoteMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (onAddQuote) {
        onAddQuote(trimmed);
      } else {
        const quoted = quoteMessageText(trimmed);
        const current = draftStore.get();
        draftStore.set(
          current.trim() ? `${quoted}\n\n${current}` : `${quoted}\n\n`,
        );
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [draftStore, onAddQuote],
  );

  const messageMenuActions = useMemo<MessageMenuAction[]>(() => {
    if (!messageMenu) return [];
    const message = messageMenu.message;
    const text = message.text;
    if (!text.trim()) return [];
    return [
      {
        id: "reply",
        label: "Reply",
        icon: "reply",
        onSelect: () => {
          tapLight();
          quoteMessage(text);
        },
      },
      {
        id: "copy",
        label: "Copy",
        icon: "copy",
        onSelect: () => {
          tapLight();
          copyMessageText(text);
        },
      },
      {
        id: "select",
        label: "Select",
        icon: "select",
        onSelect: () => {
          tapLight();
          startSelectingMessage(message.id);
        },
      },
      {
        id: "share",
        label: "Share",
        icon: "share",
        onSelect: () => {
          tapLight();
          shareMessageText(text);
        },
      },
      ...(message.role === "assistant"
        ? [speakAloudMenuAction(text, message.id)]
        : []),
    ];
  }, [messageMenu, quoteMessage, startSelectingMessage]);

  const selectingMessageIdRef = useRef<string | null>(null);
  selectingMessageIdRef.current = selectingMessageId;
  const viewportTouchRef = useRef<{ x: number; y: number; at: number } | null>(
    null,
  );
  const handleViewportTouchStart = useCallback((e: GestureResponderEvent) => {
    if (selectingMessageIdRef.current == null) return;
    const { pageX, pageY } = e.nativeEvent;
    viewportTouchRef.current = { x: pageX, y: pageY, at: Date.now() };
  }, []);
  const handleViewportTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const start = viewportTouchRef.current;
      viewportTouchRef.current = null;
      if (!start || selectingMessageIdRef.current == null) return;
      const { pageX, pageY } = e.nativeEvent;
      const moved = Math.hypot(pageX - start.x, pageY - start.y);
      if (moved < 8 && Date.now() - start.at < 350) stopSelectingMessage();
    },
    [stopSelectingMessage],
  );
  const handleListScrollBeginDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (selectingMessageIdRef.current != null) stopSelectingMessage();
      pendingSendNudgeRef.current = null;
      scroll.onScrollBeginDrag();
      historyPaging.beginDrag(conversationId);
      requestHistoryNearPosition(e.nativeEvent);
    },
    [
      conversationId,
      historyPaging,
      requestHistoryNearPosition,
      scroll.onScrollBeginDrag,
      stopSelectingMessage,
    ],
  );
  const handleListScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      historyPaging.endDrag(e.nativeEvent.velocity?.y);
      handleListScrollSettle();
    },
    [handleListScrollSettle, historyPaging],
  );
  const handleListMomentumScrollBegin = useCallback(
    () => historyPaging.beginMomentum(),
    [historyPaging],
  );
  const handleListMomentumScrollEnd = useCallback(() => {
    historyPaging.endScroll();
    handleListScrollSettle();
  }, [handleListScrollSettle, historyPaging]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);
  const activeAssistantId =
    streaming && lastMessage?.role === "assistant" ? lastMessage.id : null;
  const latestUserMessageId =
    lastMessage?.role === "user" ? lastMessage.id : null;
  useEffect(() => {
    if (!activeAssistantId) {
      scroll.clearActiveAssistantLayout();
    }
  }, [activeAssistantId, scroll.clearActiveAssistantLayout]);

  const activeMenuMessageId = messageMenu?.message.id ?? null;
  const timeHeaders = useMemo(
    () => timestampHeaders(visibleMessages),
    [visibleMessages],
  );
  const receipt = useMemo(
    () => readReceipt(visibleMessages),
    [visibleMessages],
  );
  const onOpenStellaFile = useMemo(
    () =>
      onOpenArtifact
        ? (path: string, gallery?: readonly string[]) =>
            onOpenArtifact(
              stellaFileChatArtifact(path, conversationId ?? ""),
              gallery?.map((entry) =>
                stellaFileChatArtifact(entry, conversationId ?? ""),
              ),
            )
        : undefined,
    [onOpenArtifact, conversationId],
  );
  const scrollLayoutRef = useRef(scroll);
  scrollLayoutRef.current = scroll;
  const onActiveAssistantLayout = useCallback(
    (event: LayoutChangeEvent) =>
      scrollLayoutRef.current.onActiveAssistantLayout(event),
    [],
  );
  const onLatestUserLayout = useCallback(
    (id: string, event: LayoutChangeEvent) =>
      scrollLayoutRef.current.onLatestUserLayout(id, event),
    [],
  );
  const rowStyles = useMemo(() => makeMessageRowStyles(colors), [colors]);
  const rowActions = useMemo<MessageRowActions>(
    () => ({
      onOpenArtifact,
      onOpenStellaFile,
      onOpenMessageMenu: setMessageMenu,
      onEndSelecting: stopSelectingMessage,
      onAskStella: quoteMessage,
      onOpenAgentActivity: onOpenActivity,
      onOpenReply: setReplyFocus,
      onOpenReport: showReport,
    }),
    [
      onOpenArtifact,
      onOpenStellaFile,
      stopSelectingMessage,
      quoteMessage,
      onOpenActivity,
      showReport,
    ],
  );
  const menuCloneRowActions = useMemo<MessageRowActions>(
    () => ({
      onOpenMessageMenu: setMessageMenu,
      onEndSelecting: stopSelectingMessage,
      onAskStella: quoteMessage,
    }),
    [stopSelectingMessage, quoteMessage],
  );
  const rowEnv = useMemo<ChatRowEnv>(
    () => ({
      conversationId: conversationId ?? "",
      colors,
      rowStyles,
      timestampHeaderStyle: styles.timestampHeader,
      actions: rowActions,
      desktopAccess,
      timeHeaders,
      receipt,
      replyContexts,
      carriedQuotes: quoteCarry.carried,
      forwardedQuotes: quoteCarry.forwarded,
      hiddenAgentChipIds,
      showAgentCards: SHOW_AGENT_CARDS,
      lastMessageId: lastMessage?.id ?? null,
      historyLoading,
      activeAssistantId,
      latestUserMessageId,
      placingReplyId,
      activeMenuMessageId,
      selectingMessageId,
      seenMessageIds: seenMessageIdsRef.current,
      onActiveAssistantLayout,
      onLatestUserLayout,
    }),
    [
      conversationId,
      colors,
      rowStyles,
      styles.timestampHeader,
      rowActions,
      desktopAccess,
      timeHeaders,
      receipt,
      replyContexts,
      quoteCarry,
      hiddenAgentChipIds,
      lastMessage?.id,
      historyLoading,
      activeAssistantId,
      latestUserMessageId,
      placingReplyId,
      activeMenuMessageId,
      selectingMessageId,
      onActiveAssistantLayout,
      onLatestUserLayout,
    ],
  );
  // Rows read the env from this store, so `renderItem` never changes and the
  // list never re-renders every mounted row when the pane does. Staged during
  // render so a row mounting in this commit reads it; published after commit
  // so only rows whose slice changed re-render.
  const [rowEnvStore] = useState(() => createChatRowEnvStore(rowEnv));
  rowEnvStore.stage(rowEnv);
  useLayoutEffect(() => rowEnvStore.publish(), [rowEnv, rowEnvStore]);
  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ChatMessage>) => {
      return (
        <View style={styles.listRow}>
          <ChatListRow item={item} store={rowEnvStore} />
        </View>
      );
    },
    [rowEnvStore, styles.listRow],
  );
  const getItemType = useCallback(
    (item: ChatMessage) =>
      item.id.startsWith(INLINE_ASK_RECORD_PREFIX) ? "ask-record" : item.role,
    [],
  );

  const listFooter = useMemo(
    () => (
      <View style={styles.chatTail}>
        <WorkingIndicator
          active={workingIndicator?.active ?? streaming}
          exitImmediately={workingIndicator?.exitImmediately}
          status={workingIndicator?.status}
          toolName={workingIndicator?.toolName}
          toolCallId={workingIndicator?.toolCallId}
          onScreen={!scroll.tailOffscreen}
          vacateFor={landingReplyId}
        />
      </View>
    ),
    [
      streaming,
      workingIndicator,
      styles.chatTail,
      scroll.tailOffscreen,
      landingReplyId,
    ],
  );

  const search = useChatSearch();
  const searchOpen = search.isOpen;
  const searchQuery = search.query.trim();
  const searchActive = searchQuery.length > 0;
  const searchResults = useChatSearchResults(
    visibleMessages,
    searchOpen,
    searchQuery,
  );

  const summaries = useConversationSummaries(
    conversationId,
    visibleMessages,
    CATCH_UP_ENABLED && Boolean(conversationId),
  );
  const [summaryOpen, setSummaryOpen] = useState<{ requestNew: boolean } | null>(null);
  const [summaryJump, setSummaryJump] = useState<{ link: CatchUpLink; pages: number } | null>(null);
  const summaryJumpAfterCloseRef = useRef<CatchUpLink | null>(null);
  useEffect(() => {
    if (!summaryJump) return;
    const { link } = summaryJump;
    const index = listMessages.findIndex(
      (message) =>
        message.sequence === link.seq ||
        link.messageIds.includes(message.id) ||
        (message.canonicalId !== undefined && link.messageIds.includes(message.canonicalId)),
    );
    if (index >= 0) {
      setSummaryJump(null);
      scroll.releaseFollow();
      scroll.listRef.current?.scrollToIndex({ index, animated: true, viewOffset: topInset + 24 });
      return;
    }
    if (historyPageLoading) return;
    if (!hasOlderHistory || !onLoadOlderHistory || summaryJump.pages >= 8) {
      setSummaryJump(null);
      Alert.alert(t("app.chat.catchUp.notLoaded"));
      return;
    }
    setSummaryJump({ link, pages: summaryJump.pages + 1 });
    void onLoadOlderHistory();
  }, [
    hasOlderHistory,
    historyPageLoading,
    listMessages,
    onLoadOlderHistory,
    scroll,
    summaryJump,
    t,
    topInset,
  ]);
  const openSummary = useCallback(() => {
    inputRef.current?.blur();
    setSummaryOpen({
      requestNew:
        summaries.offer.count >= CATCH_UP_MIN_NEW_MESSAGES && !summaries.pending,
    });
  }, [summaries.offer.count, summaries.pending]);
  const showSummaryPill = summaries.visible && !searchOpen;

  const jumpToMessage = useCallback(
    (index: number) => {
      search.close();
      setTimeout(() => {
        scroll.listRef.current?.scrollToIndex({
          index,
          animated: true,
          viewOffset: topInset,
        });
      }, 60);
    },
    [search, scroll.listRef, topInset],
  );

  const empty = listMessages.length === 0;
  const composerHasContent =
    !draftEmpty || (attachments?.length ?? 0) > 0 || (quotes?.length ?? 0) > 0;
  const canSubmit =
    sendReady &&
    (hasText || (attachments?.length ?? 0) > 0 || (quotes?.length ?? 0) > 0);
  const dictationInline = isListening && !hasText;

  useEffect(() => {
    if (!composerModelPicker?.pinned || dictationInline) {
      setModelPickerAnchor(null);
    }
  }, [composerModelPicker?.pinned, dictationInline]);

  const showRealtimeVoice = Boolean(
    voiceEnabled &&
      serverFeatures.realtimeVoice &&
      realtimeVoiceConversationId &&
      (onRealtimeVoiceAction || realtimeVoiceDesktopAccess) &&
      composerEnabled &&
      !offline &&
      !composerHasContent &&
      dictationStatus === "idle",
  );
  const onComposerFocus = useCallback(() => {
    prewarmDictation();
    if (selectingMessageIdRef.current != null) stopSelectingMessage();
    if (askActiveRef.current && !askCollapsedRef.current) {
      LayoutAnimation.configureNext(LAYOUT_SPRING);
      setAskCollapsed(true);
    }
  }, [prewarmDictation, stopSelectingMessage]);
  const interventionRoom =
    paneHeight > 0
      ? paneHeight - topInset - ASK_TOP_GAP - keyboardExtra
      : undefined;

  const listContentContainerStyle = useMemo(
    () => [
      styles.list,
      { paddingTop: topInset + LIST_TOP_GAP, paddingBottom: listBottomInsetPx },
    ],
    [styles.list, listBottomInsetPx, topInset],
  );
  const emptyStateStyle = useMemo(
    () => [styles.emptyState, { paddingTop: topInset }],
    [styles.emptyState, topInset],
  );
  const taperHeight = topInset + TOP_TAPER_TAIL;
  const taperSolidStop =
    topInset > 0 ? Math.min(1, safeAreaTop / taperHeight) : 0;
  const taperBackdropOffset = shellTopInset - topInset;
  const topTaper = useMemo(
    () => (
      <View
        style={[styles.topTaper, { height: taperHeight }]}
        pointerEvents="none"
        collapsable={false}
      >
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["#000", "#000", "rgba(0,0,0,0)"]}
              locations={[0, taperSolidStop, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: -taperBackdropOffset,
              height: screenHeight,
            }}
          >
            <AppBackdrop />
          </View>
        </MaskedView>
      </View>
    ),
    [
      screenHeight,
      styles.topTaper,
      taperBackdropOffset,
      taperHeight,
      taperSolidStop,
    ],
  );
  return (
    <ReplyHandoffContext.Provider value={replyHandoffController}>
      <View
        ref={rootRef}
        collapsable={false}
        style={styles.screen}
        onLayout={onPaneLayout}
      >
        <View
          style={styles.viewport}
          onTouchStart={handleViewportTouchStart}
          onTouchEnd={handleViewportTouchEnd}
        >
          {historyLoading ? (
            <View style={emptyStateStyle} />
          ) : empty ? (
            <Pressable style={emptyStateStyle} onPress={() => Keyboard.dismiss()}>
              {emptyContent}
            </Pressable>
          ) : (
            <>
              <Reanimated.View style={[styles.messageList, listKeyboardStyle]}>
                <LegendList<ChatMessage>
                  ref={scroll.listRef}
                  pointerEvents={replyFocus ? "none" : "auto"}
                  accessibilityElementsHidden={Boolean(replyFocus)}
                  importantForAccessibility={
                    replyFocus ? "no-hide-descendants" : "auto"
                  }
                  style={styles.messageList}
                  contentContainerStyle={listContentContainerStyle}
                  data={listMessages}
                  estimatedItemSize={64}
                  renderItem={renderItem}
                  keyExtractor={keyExtractor}
                  getItemType={getItemType}
                  ListFooterComponent={listFooter}
                  onScroll={handleListScroll}
                  onScrollBeginDrag={handleListScrollBeginDrag}
                  onScrollEndDrag={handleListScrollEndDrag}
                  onMomentumScrollBegin={handleListMomentumScrollBegin}
                  onMomentumScrollEnd={handleListMomentumScrollEnd}
                  onContentSizeChange={handleListContentSizeChange}
                  scrollEventThrottle={16}
                  showsVerticalScrollIndicator={false}
                  keyboardDismissMode="on-drag"
                  fadingEdgeLength={EDGE_FADE}
                  initialScrollAtEnd={initialScrollAtEndRef.current === true}
                  maintainVisibleContentPosition={maintainVisibleContentPosition}
                  maintainScrollAtEnd={
                    dataChangeScrollOwner === "legend-tail"
                      ? LEGEND_TAIL_SCROLL_AT_END
                      : false
                  }
                />
              </Reanimated.View>
              {/* Top taper — fades the list into the surface at the top edge so
                  messages scrolling under the top bar dissolve instead of
                  hard-cutting. Cross-platform (RN `fadingEdgeLength` is
                  Android-only). Paints the *actual* app backdrop (aligned to the
                  screen via the top-bar offset) and masks it to a vertical fade,
                  so it matches the soft gradient seamlessly instead of stamping a
                  flat `colors.background` band over it. */}
              {/* Android's native MaskedView does not implement pointerEvents.
                  Keep touch exclusion on a real RN View around the whole mask,
                  including its screen-height backdrop child. */}
              {topTaper}
            </>
          )}
          {replyFocus && (
            <ReplyViewer
              key={`${conversationId}:${replyFocus.kind === "agent" ? replyFocus.threadId : replyFocus.id}`}
              bottomReserve={footerHeight}
              root={replyFocus}
              messages={visibleMessages}
              colors={colors}
              onClose={closeReplyFocus}
              hasOlder={hasOlderHistory}
              onLoadOlder={onLoadOlderHistory}
              renderMessage={(item, contexts) => (
                <ChatMessageRow
                  item={item}
                  conversationId={conversationId ?? ""}
                  animate={false}
                  styles={rowStyles}
                  colors={colors}
                  menuActive={false}
                  isSelecting={false}
                  anySelecting={false}
                  actions={rowActions}
                  carriedQuotes={quoteCarry.carried.get(item.id)}
                  quotesForwarded={quoteCarry.forwarded.has(item.id)}
                  contextRef={contexts.contexts.get(item.id)}
                  contextStatus={contextStatusFor(
                    contexts,
                    contexts.contexts.get(item.id),
                  )}
                  desktopAccess={desktopAccess}
                />
              )}
            />
          )}
          {openReport && conversationId ? (
            <AgentReportPopover
              key={openReport.refs.map((ref) => ref.threadId).join(" ")}
              references={openReport.refs}
              anchor={openReport.anchor}
              conversationId={conversationId}
              journalReports={openReportJournal}
              colors={colors}
              onClose={closeReport}
              topInset={topInset}
            />
          ) : null}
          <View
            pointerEvents={replyFocus ? "none" : "box-none"}
            style={[
              StyleSheet.absoluteFill,
              replyFocus ? styles.hiddenWhileFocused : null,
            ]}
          >
            {!searchOpen ? (
              <CatchUpPill
                visible={catchUpVisible}
                top={topInset + CATCH_UP_PILL_GAP}
                colors={colors}
              />
            ) : null}
            {!historyLoading && !empty ? (
              <Reanimated.View
                pointerEvents="box-none"
                style={[StyleSheet.absoluteFill, composerKeyboardStyle]}
              >
                <ScrollToBottomFab
                  visible={scroll.awayFromBottom}
                  hasUnread={unread}
                  onPress={scroll.scrollToBottom}
                  colors={colors}
                  bottomOffset={footerHeight + FLOATING_CONTROL_GAP}
                />
              </Reanimated.View>
            ) : null}
          </View>
          {searchOpen && searchActive ? (
            <ChatSearchResults
              results={searchResults}
              query={searchQuery}
              topInset={topInset}
              colors={colors}
              onSelect={jumpToMessage}
            />
          ) : null}
        </View>

        <Reanimated.View
          style={[
            styles.footerOverlay,
            composerKeyboardStyle,
            searchOpen && styles.hiddenFooter,
          ]}
          onLayout={onFooterLayout}
          pointerEvents={searchOpen ? "none" : "box-none"}
        >
          {offline ? (
            <View style={styles.offlineNotice} pointerEvents="none">
              <Icon name="wifi-off" size={13} color={colors.textMuted} />
              <Text
                style={styles.offlineNoticeText}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                You're offline
              </Text>
            </View>
          ) : null}
          {showSummaryPill ? (
            <SummaryPill
              count={summaries.offer.count}
              onPress={openSummary}
              colors={colors}
            />
          ) : null}
          <Composer
            colors={colors}
            inputRef={inputRef}
            draftStore={draftStore}
            enabled={composerEnabled}
            placeholder={placeholder}
            intervention={composerIntervention}
            compact={askActive && !askCollapsed}
            askCollapsed={askActive && askCollapsed}
            onExpandAsk={expandAsk}
            interventionRoom={interventionRoom}
            bottomPad={composerBottomPad}
            draftEmpty={draftEmpty}
            hasText={hasText}
            canSubmit={canSubmit}
            streaming={streaming}
            onSubmit={submit}
            onStop={onStop}
            onInputFocus={onComposerFocus}
            onPressPlus={onPressPlus}
            dictationStatus={dictationStatus}
            onToggleVoice={toggleVoice}
            onCancelDictation={cancelDictationInput}
            onConfirmDictation={confirmDictationInput}
            onStopAndSendVoice={stopAndSendVoice}
            showRealtimeVoice={showRealtimeVoice}
            onOpenRealtimeVoice={openRealtimeVoice}
            modelPicker={composerModelPicker}
            modelPickerAnchorRef={modelPickerAnchorRef}
            onPressModelPicker={onPressModelPicker}
            quotes={quotes}
            onRemoveQuote={onRemoveQuote}
            attachments={attachments}
            onRemoveAttachment={onRemoveAttachment}
            onRetryAttachment={onRetryAttachment}
          />
        </Reanimated.View>
        <AddContextSheet
          visible={addSheetOpen}
          onClose={() => setAddSheetOpen(false)}
          onDismissed={onAddSheetDismissed}
          onCamera={
            enableAttachments
              ? () => chooseFromAddSheet(() => void takePhoto())
              : undefined
          }
          onPhotos={
            enableAttachments
              ? () => chooseFromAddSheet(() => void pickImage())
              : undefined
          }
          onFiles={
            enableAttachments
              ? () => chooseFromAddSheet(() => void pickDocument())
              : undefined
          }
          readAloud={readAloud.enabled}
          onReadAloudChange={
            serverFeatures.readAloud
              ? (next) => void readAloud.setEnabled(next)
              : undefined
          }
        />
        {summaryOpen && conversationId ? (
          <SummaryPopover
            conversationId={conversationId}
            catchUps={summaries.catchUps}
            requestNew={summaryOpen.requestNew}
            onJump={(link) => {
              summaryJumpAfterCloseRef.current = link;
            }}
            onClose={() => {
              setSummaryOpen(null);
              const link = summaryJumpAfterCloseRef.current;
              summaryJumpAfterCloseRef.current = null;
              if (link) setTimeout(() => setSummaryJump({ link, pages: 0 }), 60);
            }}
            colors={colors}
          />
        ) : null}
        {messageMenu && messageMenuActions.length > 0 ? (
          <MessageContextMenu
            key={messageMenu.message.id}
            rect={messageMenu.anchor}
            side={messageMenu.message.role === "user" ? "right" : "left"}
            bubble={
              <ChatMessageRow
                item={messageMenu.message}
                conversationId={conversationId ?? ""}
                animate={false}
                styles={rowStyles}
                colors={colors}
                menuActive={false}
                isSelecting={false}
                anySelecting={false}
                actions={menuCloneRowActions}
                menuClone
              />
            }
            actions={messageMenuActions}
            colors={colors}
            onDismiss={dismissMessageMenu}
          />
        ) : null}
        <PlusMenuPopover
          visible={Boolean(modelPickerAnchor) && modelPickerOptions.length > 0}
          anchor={modelPickerAnchor}
          options={modelPickerOptions}
          onDismiss={dismissModelPicker}
          colors={colors}
          containerRef={rootRef}
          minWidth={320}
          wrapLabels
        />
        <RealtimeVoiceOverlay
          visible={realtimeVoiceOpen}
          conversationId={realtimeVoiceConversationId}
          execution={realtimeVoiceExecution}
          desktopAccess={realtimeVoiceDesktopAccess}
          signInRequired={realtimeVoiceSignInRequired}
          messages={messages}
          tasks={activityTasks ?? []}
          chatBusy={streaming}
          onPerformAction={performRealtimeVoiceAction}
          onClose={() => setRealtimeVoiceOpen(false)}
        />
      </View>
    </ReplyHandoffContext.Provider>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      marginHorizontal: -SHELL_CONTENT_PADDING,
      position: "relative",
    },
    footerOverlay: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0,
    },
    viewport: { flex: 1, minHeight: 0, position: "relative" },
    hiddenWhileFocused: { display: "none" },
    messageList: { flex: 1 },
    topTaper: {
      left: 0,
      position: "absolute",
      right: 0,
      top: 0,
    },
    list: {
      paddingHorizontal: CHAT_HORIZONTAL_INSET,
    },
    // Every row carries the gap below it, the last one too, so a new row never
    // resizes the one before it. The tail is shorter by the same gap.
    listRow: { paddingBottom: MESSAGE_LIST_GAP },
    chatTail: {
      minHeight: CHAT_TAIL_GAP - MESSAGE_LIST_GAP,
      paddingTop: ASSISTANT_ROW_PAD_VERTICAL,
      justifyContent: "flex-start",
    },
    emptyState: {
      alignItems: "center",
      flex: 1,
      justifyContent: "center",
    },
    hiddenFooter: {
      display: "none",
    },
    timestampHeader: {
      alignSelf: "center",
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      letterSpacing: -0.1,
      paddingBottom: 10,
      paddingTop: 14,
    },
    offlineNotice: {
      alignItems: "center",
      alignSelf: "center",
      flexDirection: "row",
      gap: 6,
      paddingBottom: 2,
      paddingTop: 4,
    },
    offlineNoticeText: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      letterSpacing: -0.1,
    },
  } as const);
