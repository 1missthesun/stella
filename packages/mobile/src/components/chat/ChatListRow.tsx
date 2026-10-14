import {
  memo,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { ChatMessage } from "../../types";
import type { Colors } from "../../theme/colors";
import type { StoredPhoneAccess } from "../../lib/phone-access";
import type { MobileReplyContexts } from "../../lib/mobile-reply-context";
import { formatTimestampHeader } from "../../lib/message-time-labels";
import { shouldAnimateMessageEntry } from "../../lib/message-row-identity";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import type { ReplyAgentStatus } from "../ReplyPreview";
import { UserAskRecordView } from "../UserAskCard";
import { Text } from "../Text";
import {
  ChatMessageRow,
  type CompletionQuote,
  MessageEntry,
  type MessageRowActions,
  type MessageRowStyles,
} from "./MessageRow";

export const INLINE_ASK_RECORD_PREFIX = "inline-ask-record:";

/**
 * Everything a transcript row reads besides its own message. The pane
 * publishes a fresh one per render; each row picks out only what concerns it,
 * so an arriving message re-renders the rows whose view actually changed
 * instead of every mounted row (the list's `renderItem` stays stable).
 */
export type ChatRowEnv = {
  conversationId: string;
  colors: Colors;
  rowStyles: MessageRowStyles;
  timestampHeaderStyle: StyleProp<TextStyle>;
  actions: MessageRowActions;
  desktopAccess: StoredPhoneAccess | null | undefined;
  timeHeaders: ReadonlyMap<string, number>;
  receipt: { id: string; label: string } | null;
  replyContexts: MobileReplyContexts;
  carriedQuotes: ReadonlyMap<string, CompletionQuote[]>;
  forwardedQuotes: ReadonlySet<string>;
  hiddenAgentChipIds: ReadonlySet<string>;
  showAgentCards: boolean;
  lastMessageId: string | null;
  historyLoading: boolean;
  activeAssistantId: string | null;
  latestUserMessageId: string | null;
  placingReplyId: string | null;
  activeMenuMessageId: string | null;
  selectingMessageId: string | null;
  seenMessageIds: Set<string>;
  onActiveAssistantLayout: (event: LayoutChangeEvent) => void;
  onLatestUserLayout: (id: string, event: LayoutChangeEvent) => void;
};

export type ChatRowEnvStore = {
  get: () => ChatRowEnv;
  /** Makes `env` what rows read from now on, without waking them. */
  stage: (env: ChatRowEnv) => void;
  /** Wakes rows if the staged env differs from the one they last saw. */
  publish: () => void;
  subscribe: (listener: () => void) => () => void;
};

export function createChatRowEnvStore(initial: ChatRowEnv): ChatRowEnvStore {
  let current = initial;
  let published = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    stage: (env) => {
      current = env;
    },
    publish: () => {
      if (published === current) return;
      published = current;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type RowView = {
  timeHeader: number | undefined;
  layout: "assistant" | "user" | null;
  menuActive: boolean;
  isSelecting: boolean;
  anySelecting: boolean;
  contextRef: ReplyRef | undefined;
  contextStatus: ReplyAgentStatus | undefined;
  receiptLabel: string | null;
  carriedQuotes: CompletionQuote[] | undefined;
  quotesForwarded: boolean;
  hideAgentChips: boolean;
  env: Pick<
    ChatRowEnv,
    | "conversationId"
    | "colors"
    | "rowStyles"
    | "timestampHeaderStyle"
    | "actions"
    | "desktopAccess"
    | "onActiveAssistantLayout"
    | "onLatestUserLayout"
  >;
};

const selectRowView = (
  env: ChatRowEnv,
  id: string,
  previous: RowView | null,
): RowView => {
  const isActiveAssistant = id === env.activeAssistantId;
  const isLatestUser = id === env.latestUserMessageId || id === env.placingReplyId;
  const contextRef = env.replyContexts.contexts.get(id);
  const stable =
    previous &&
    previous.env.conversationId === env.conversationId &&
    previous.env.colors === env.colors &&
    previous.env.rowStyles === env.rowStyles &&
    previous.env.timestampHeaderStyle === env.timestampHeaderStyle &&
    previous.env.actions === env.actions &&
    previous.env.desktopAccess === env.desktopAccess &&
    previous.env.onActiveAssistantLayout === env.onActiveAssistantLayout &&
    previous.env.onLatestUserLayout === env.onLatestUserLayout
      ? previous.env
      : {
          conversationId: env.conversationId,
          colors: env.colors,
          rowStyles: env.rowStyles,
          timestampHeaderStyle: env.timestampHeaderStyle,
          actions: env.actions,
          desktopAccess: env.desktopAccess,
          onActiveAssistantLayout: env.onActiveAssistantLayout,
          onLatestUserLayout: env.onLatestUserLayout,
        };
  return {
    timeHeader: env.timeHeaders.get(id),
    layout:
      isActiveAssistant && id !== env.placingReplyId
        ? "assistant"
        : isLatestUser
          ? "user"
          : null,
    menuActive: id === env.activeMenuMessageId,
    isSelecting: id === env.selectingMessageId,
    anySelecting: env.selectingMessageId != null,
    contextRef,
    contextStatus:
      contextRef?.kind === "agent"
        ? env.replyContexts.agentStates.get(contextRef.threadId)
        : undefined,
    receiptLabel: env.receipt?.id === id ? env.receipt.label : null,
    carriedQuotes: env.carriedQuotes.get(id),
    quotesForwarded: env.forwardedQuotes.has(id),
    hideAgentChips: !env.showAgentCards || env.hiddenAgentChipIds.has(id),
    env: stable,
  };
};

const sameRowView = (a: RowView, b: RowView): boolean => {
  for (const key of Object.keys(a) as (keyof RowView)[]) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
};

/** One row's slice of the pane state; re-renders only when that slice changes. */
function useRowView(store: ChatRowEnvStore, id: string): RowView {
  const cache = useRef<{ env: ChatRowEnv; id: string; view: RowView } | null>(
    null,
  );
  const getSnapshot = () => {
    const env = store.get();
    const cached = cache.current;
    if (cached && cached.env === env && cached.id === id) return cached.view;
    const next = selectRowView(env, id, cached?.view ?? null);
    const view = cached && sameRowView(cached.view, next) ? cached.view : next;
    cache.current = { env, id, view };
    return view;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

export const ChatListRow = memo(function ChatListRow({
  item,
  store,
}: {
  item: ChatMessage;
  store: ChatRowEnvStore;
}) {
  if (item.id.startsWith(INLINE_ASK_RECORD_PREFIX) && item.askRecords) {
    return (
      <View>
        {item.askRecords.map((record) => (
          <UserAskRecordView key={record.id} record={record} />
        ))}
      </View>
    );
  }
  return <ChatMessageListRow key={item.id} item={item} store={store} />;
});

function ChatMessageListRow({
  item,
  store,
}: {
  item: ChatMessage;
  store: ChatRowEnvStore;
}) {
  const view = useRowView(store, item.id);
  // Entry animation is decided once, when the row first mounts: an id the
  // pane has never shown pops in, and a reply pops only while it is the tail.
  const [entry] = useState(() => {
    const env = store.get();
    const fresh = shouldAnimateMessageEntry(env.seenMessageIds, item.id);
    return {
      fresh,
      reply: fresh && item.id === env.lastMessageId && !env.historyLoading,
    };
  });
  const { env } = view;
  const id = item.id;
  const onLatestUserLayout = env.onLatestUserLayout;
  const onUserLayout = useCallback(
    (event: LayoutChangeEvent) => onLatestUserLayout(id, event),
    [onLatestUserLayout, id],
  );
  return (
    <MessageEntry
      animate={entry.fresh && item.role !== "assistant"}
      onLayout={
        view.layout === "assistant"
          ? env.onActiveAssistantLayout
          : view.layout === "user"
            ? onUserLayout
            : undefined
      }
    >
      {view.timeHeader !== undefined ? (
        <Text
          style={env.timestampHeaderStyle}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {formatTimestampHeader(view.timeHeader)}
        </Text>
      ) : null}
      <ChatMessageRow
        item={item}
        conversationId={env.conversationId}
        animate={entry.reply}
        styles={env.rowStyles}
        colors={env.colors}
        menuActive={view.menuActive}
        isSelecting={view.isSelecting}
        anySelecting={view.anySelecting}
        actions={env.actions}
        contextRef={view.contextRef}
        contextStatus={view.contextStatus}
        desktopAccess={env.desktopAccess}
        receiptLabel={view.receiptLabel}
        carriedQuotes={view.carriedQuotes}
        quotesForwarded={view.quotesForwarded}
        hideAgentChips={view.hideAgentChips}
      />
    </MessageEntry>
  );
}
