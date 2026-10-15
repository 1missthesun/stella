import {
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fileDisplayName } from "@stella/contracts/file-display-name";
import {
  ActivityIndicator,
  Animated,
  Easing,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  type TextLayoutEventData,
  useWindowDimensions,
  View,
} from "react-native";
import { Text } from "../Text";
import { Image } from "expo-image";
import { extractPlainText } from "react-native-nitro-markdown";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import { driveLinkPath, driveLinkTarget } from "@stella/contracts/cloud-world-paths";
import { extractStellaAppLinkSlugs } from "@stella/contracts/workspace-apps";
import {
  extractFileLinkTargets,
  unlinkLocalFileLinks,
} from "@stella/contracts/local-file-links";
import { AssistantBubble, SENT_BUBBLE_POP, useBubblePop } from "../BubblePop";
import { type AgentReplyRef } from "../ReplyViewer";
import type { ReportAnchor } from "../AgentReport";
import {
  ReplyPreview,
  replyTitle,
  type ReplyAgentStatus,
} from "../ReplyPreview";
import { Icon } from "../Icon";
import { AssistantMarkdown } from "../AssistantMarkdown";
import { AssistantTextSelection } from "../AssistantTextSelection";
import { MESSAGE_PRESS_SCALE } from "../MessageContextMenu";
import { MessageEvidenceStrip } from "../evidence/MessageEvidenceStrip";
import { AppPreviewCard } from "../AppPreviewCard";
import { MapRouteCard } from "../MapRouteCard";
import type { AnchorRect } from "./PlusMenu";
import { assistantBubbleNeedsBoundedWidth } from "../../lib/assistant-bubble-layout";
import { presentAssistantText } from "@stella/contracts/assistant-internal-text";
import { artifactAttachmentTarget } from "../../lib/mobile-artifacts";
import {
  AttachmentTileRow,
  FileTile,
  ImageTile,
  PastedTextTile,
  type AttachmentTileItem,
} from "./AttachmentTiles";
import {
  resolveCloudDriveFileUri,
  useCloudDriveFileUri,
} from "../../lib/use-cloud-drive-file-uri";
import { scheduleReceiptText } from "../../lib/schedule-receipt-summary";
import {
  isStandInArtifactRow,
  messageHasText,
} from "../../lib/message-row-identity";
import {
  consolidateRowArtifacts,
  messageRowArtifacts,
} from "../../lib/agent-artifact-consolidation";
import type { StoredPhoneAccess } from "../../lib/phone-access";
import {
  bytesToDataUri,
  readLinkedArtifactFile,
} from "../../lib/desktop-artifact-data";
import { isDeviceOfflineError } from "../../lib/device-requests";
import { tapMedium } from "../../lib/haptics";
import { CONTENT_MAX_FONT_SCALE } from "../../lib/font-scale";
import {
  isUserMessageTruncatable,
  shouldRemeasureUserMessageWidth,
  userMessageNumberOfLines,
} from "../../lib/user-message-clamp";
import { type Colors } from "../../theme/colors";
import { fadeHex } from "../../theme/oklch";
import { fonts } from "../../theme/fonts";
import type { ChatArtifact, ChatMessage } from "../../types";
import { UserAskRecordView } from "../UserAskCard";
import { ReminderActions } from "./ReminderActions";
import { ScheduleNoticeCard } from "./ScheduleNoticeCard";

export type MessageRowStyles = ReturnType<typeof makeMessageRowStyles>;

export type MessageRowActions = {
  onOpenArtifact?: (
    artifact: ChatArtifact,
    gallery?: readonly ChatArtifact[],
  ) => void;
  onOpenStellaFile?: (path: string, gallery?: readonly string[]) => void;
  onOpenMessageMenu: (request: MessageMenuRequest) => void;
  onEndSelecting: () => void;
  onAskStella: (text: string) => void;
  onOpenAgentActivity?: () => void;
  onOpenReply?: (ref: ReplyRef) => void;
  onOpenReport?: (refs: readonly AgentReplyRef[], anchor?: ReportAnchor) => void;
};

const MESSAGE_HOLD_MS = 180;
const MESSAGE_LONG_PRESS_MS = 420;
export const ASSISTANT_ROW_PAD_VERTICAL = 2;

export function MessageEntry({
  children,
  onLayout,
  animate,
}: {
  children: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
  animate: boolean;
}) {
  const animatedStyle = useBubblePop(animate, SENT_BUBBLE_POP);
  const popped = useRef(animate).current;
  if (!popped) return <View onLayout={onLayout}>{children}</View>;
  return (
    <Animated.View onLayout={onLayout} style={animatedStyle}>
      {children}
    </Animated.View>
  );
}

const REACTION_POP = { side: "left", rise: 4, scale: 0.4 } as const;

function ReactionBadge({
  emoji,
  fresh,
  styles,
}: {
  emoji: string;
  fresh: boolean;
  styles: MessageRowStyles;
}) {
  const popStyle = useBubblePop(fresh, REACTION_POP);
  return (
    <Animated.View
      style={[styles.reactionBadge, popStyle]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Stella reacted ${emoji}`}
      pointerEvents="none"
    >
      <Text style={styles.reactionBadgeText} maxFontSizeMultiplier={1.2}>
        {emoji}
      </Text>
    </Animated.View>
  );
}

export type MessageMenuRequest = { message: ChatMessage; anchor: AnchorRect };

/**
 * User message body with collapse/expand for long text — the mobile analogue
 * of desktop's `UserMessageBody`. Collapsed by default when the rendered text
 * exceeds `USER_MESSAGE_COLLAPSE_LINES`; a tappable "Show more" / "Show less"
 * toggle then reveals or re-hides the overflow.
 *
 * Overflow is detected from the native text-layout line boxes (not a
 * character count). The measuring pass renders at the collapse cap plus one
 * line — enough to distinguish "fits" from "overflows" without ever painting
 * a long message at full height (a full-height first paint used to inflate
 * the row after send and skew the post-send scroll anchor). Later width
 * changes remeasure so wrap at a new bubble width can grow or shrink the
 * toggle.
 */
function UserMessageText({
  text,
  styles,
}: {
  text: string;
  styles: MessageRowStyles;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const [totalLines, setTotalLines] = useState<number | null>(null);
  const [measuring, setMeasuring] = useState(true);
  const measuredWidthRef = useRef<number | null>(null);

  useEffect(() => {
    setExpanded(false);
    setTotalLines(null);
    setMeasuring(true);
    measuredWidthRef.current = null;
  }, [text]);

  // Remeasure from the viewport width, not the text box itself. User bubbles
  // are width:fit-content, so clamping the first four lines can shrink the
  // box and would otherwise oscillate if we keyed off the text layout width.
  useEffect(() => {
    if (
      shouldRemeasureUserMessageWidth(measuredWidthRef.current, windowWidth)
    ) {
      measuredWidthRef.current = windowWidth;
      setMeasuring(true);
      return;
    }
    if (measuredWidthRef.current === null) {
      measuredWidthRef.current = windowWidth;
    }
  }, [windowWidth]);

  const handleTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      const lines = event.nativeEvent.lines.length;
      if (measuring || totalLines === null) {
        setTotalLines(lines);
        setMeasuring(false);
      }
    },
    [measuring, totalLines],
  );

  const isTruncatable = isUserMessageTruncatable(totalLines);

  return (
    <>
      <Text
        style={styles.userText}
        maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        onTextLayout={handleTextLayout}
        numberOfLines={userMessageNumberOfLines({
          expanded,
          measuring,
          truncatable: isTruncatable,
        })}
      >
        {text}
      </Text>
      {isTruncatable ? (
        <Pressable
          onPress={() => setExpanded((prev) => !prev)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Show less of this message" : "Show more of this message"
          }
        >
          {({ pressed }) => (
            <Text
              style={[styles.userToggle, pressed && styles.userTogglePressed]}
              maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
            >
              {expanded ? "Show less" : "Show more"}
            </Text>
          )}
        </Pressable>
      ) : null}
    </>
  );
}

const generatedImageAspectRatio = (value: string | undefined): number => {
  const match = value
    ?.trim()
    .match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return 4 / 3;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 4 / 3;
};

const GeneratedImageTile = memo(function GeneratedImageTile({
  filePath,
  conversationId,
  access,
  driveBacked,
  aspectRatio,
  alt,
  generationState,
  colors,
}: {
  filePath?: string;
  conversationId: string;
  access?: StoredPhoneAccess;
  driveBacked?: boolean;
  aspectRatio: number;
  alt: string;
  generationState?: "running" | "completed" | "failed" | "canceled";
  colors: Colors;
}) {
  const [computerUri, setComputerUri] = useState<string | null>(null);
  const [computerFailed, setComputerFailed] = useState(false);
  const [computerOffline, setComputerOffline] = useState(false);
  const drive = useCloudDriveFileUri(driveBacked && filePath ? filePath : null);
  const uri = driveBacked ? drive.uri : computerUri;
  const failed = driveBacked ? drive.failed : computerFailed;
  const offline = !driveBacked && computerOffline;
  useEffect(() => {
    let cancelled = false;
    const setUri = setComputerUri;
    const setFailed = setComputerFailed;
    setUri(null);
    setFailed(false);
    setComputerOffline(false);
    if (!filePath || driveBacked) return () => undefined;
    if (/^(?:file|https?|data):/i.test(filePath)) {
      setUri(filePath);
      return () => undefined;
    }
    const controller = new AbortController();
    void readLinkedArtifactFile(
      access ?? null,
      conversationId,
      filePath,
      controller.signal,
    )
      .then((result) => {
        if (cancelled) return;
        if (result.missing) {
          setFailed(true);
          return;
        }
        setUri(bytesToDataUri(result.bytes, result.mimeType));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setComputerOffline(isDeviceOfflineError(error));
        setFailed(true);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [access, conversationId, driveBacked, filePath]);

  return (
    <View
      accessibilityLabel={failed ? "Generated image failed to load" : alt}
      accessibilityRole="image"
      style={[
        generatedImageStyles.tile,
        { aspectRatio, backgroundColor: colors.surface },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={generatedImageStyles.image}
          contentFit="cover"
        />
      ) : (
        <View style={generatedImageStyles.placeholder}>
          {failed ||
          generationState === "failed" ||
          generationState === "canceled" ? (
            <Text style={{ color: colors.textMuted }}>
              {generationState === "canceled"
                ? "Image generation canceled"
                : generationState === "failed"
                  ? "Image generation failed"
                  : offline
                    ? "Your computer is offline"
                    : "Image unavailable"}
            </Text>
          ) : (
            <>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text
                style={[
                  generatedImageStyles.placeholderText,
                  { color: colors.textMuted },
                ]}
              >
                Generating image...
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
});

const GeneratedImageCard = memo(function GeneratedImageCard({
  artifact,
  access,
  colors,
  onPress,
}: {
  artifact: ChatArtifact;
  access?: StoredPhoneAccess;
  colors: Colors;
  onPress?: (artifact: ChatArtifact) => void;
}) {
  const payload = artifact.payload;
  const driveBacked = payload.kind === "media" && payload.driveBacked === true;
  const open = useCallback(() => {
    if (!onPress) return;
    if (
      !driveBacked ||
      payload.kind !== "media" ||
      payload.asset.kind !== "image"
    ) {
      onPress(artifact);
      return;
    }
    const asset = payload.asset;
    void Promise.all(asset.filePaths.map(resolveCloudDriveFileUri))
      .then((filePaths) =>
        onPress({
          ...artifact,
          payload: { ...payload, asset: { ...asset, filePaths } },
        }),
      )
      .catch(() => onPress(artifact));
  }, [artifact, driveBacked, onPress, payload]);
  if (payload.kind !== "media" || payload.asset.kind !== "image") return null;
  const paths =
    payload.asset.filePaths.length > 0 ? payload.asset.filePaths : [undefined];
  return (
    <Pressable
      accessibilityRole={
        payload.asset.filePaths.length > 0 ? "button" : undefined
      }
      accessibilityLabel={
        payload.generationState === "failed"
          ? "Image generation failed"
          : payload.asset.filePaths.length > 0
            ? "Open generated image"
            : "Generating image"
      }
      disabled={payload.asset.filePaths.length === 0}
      onPress={open}
      style={generatedImageStyles.strip}
    >
      {paths.map((filePath, index) => (
        <GeneratedImageTile
          key={filePath ?? `${artifact.id}:${index}`}
          filePath={filePath}
          conversationId={artifact.conversationId}
          access={access}
          driveBacked={driveBacked}
          aspectRatio={generatedImageAspectRatio(payload.aspectRatio)}
          alt={payload.prompt ?? "Generated image"}
          generationState={payload.generationState}
          colors={colors}
        />
      ))}
    </Pressable>
  );
});

const generatedImageStyles = StyleSheet.create({
  image: { height: "100%", width: "100%" },
  placeholder: {
    alignItems: "center",
    flex: 1,
    gap: 8,
    justifyContent: "center",
  },
  placeholderText: { fontFamily: fonts.sans.regular, fontSize: 14 },
  strip: { gap: 8 },
  tile: { borderRadius: 14, maxWidth: 320, overflow: "hidden", width: "100%" },
});

export type CompletionQuote = {
  key: string;
  artifactId: string;
  ref: AgentReplyRef;
};

const completionQuotesByMessage = new WeakMap<ChatMessage, CompletionQuote[]>();
const NO_COMPLETION_QUOTES: CompletionQuote[] = [];

export const messageCompletionQuotes = (message: ChatMessage): CompletionQuote[] => {
  if (!message.artifacts?.length) return NO_COMPLETION_QUOTES;
  let quotes = completionQuotesByMessage.get(message);
  if (!quotes) {
    quotes = rowCompletionQuotes(messageRowArtifacts(message).agentWork);
    completionQuotesByMessage.set(message, quotes);
  }
  return quotes;
};

export const rowCompletionQuotes = (
  agentWork: ReturnType<typeof consolidateRowArtifacts>["agentWork"],
): CompletionQuote[] =>
  agentWork.flatMap((artifact) => {
    if (
      artifact.payload.state !== "done" ||
      artifact.payload.followUp === true ||
      artifact.payload.completion !== true
    ) {
      return [];
    }
    const agents =
      artifact.payload.agents && artifact.payload.agents.length > 0
        ? artifact.payload.agents.map((agent) => ({
            agentId: agent.agentId,
            title: agent.title,
          }))
        : (artifact.payload.agentIds ?? []).slice(0, 1).map((agentId) => ({
            agentId,
            title: artifact.payload.title,
          }));
    return agents.flatMap((agent) => {
      if (!agent.agentId) return [];
      return [
        {
          key: `${artifact.id}:${agent.agentId}`,
          artifactId: artifact.id,
          ref: {
            kind: "agent" as const,
            threadId: agent.agentId,
            title: agent.title || artifact.payload.title,
          },
        },
      ];
    });
  });

export const carryCompletionQuotes = (
  messages: readonly ChatMessage[],
): {
  carried: ReadonlyMap<string, CompletionQuote[]>;
  forwarded: ReadonlySet<string>;
} => {
  const carried = new Map<string, CompletionQuote[]>();
  const forwarded = new Set<string>();
  const empty: { ids: string[]; quotes: CompletionQuote[] } = {
    ids: [],
    quotes: [],
  };
  let pending = empty;
  for (const message of messages) {
    if (message.role !== "assistant") {
      pending = empty;
      continue;
    }
    if (messageHasText(message)) {
      if (pending.quotes.length > 0) {
        carried.set(message.id, pending.quotes);
        for (const id of pending.ids) forwarded.add(id);
      }
      pending = empty;
      continue;
    }
    const quotes = messageCompletionQuotes(message);
    if (quotes.length > 0) {
      pending = {
        ids: [...pending.ids, message.id],
        quotes: [...pending.quotes, ...quotes],
      };
    }
  }
  return { carried, forwarded };
};

type CompletionQuoteCarry = ReturnType<typeof carryCompletionQuotes>;

/**
 * `carryCompletionQuotes` over the rows `skip` doesn't drop, for a transcript
 * that changes mostly at its end: it refolds only from the last row before
 * the change where nothing was pending. Unchanged input returns the previous
 * result.
 */
export const createCompletionQuoteCarry = () => {
  let previous: {
    messages: readonly ChatMessage[];
    carried: { at: number; id: string; quotes: CompletionQuote[] }[];
    forwarded: { at: number; id: string }[];
    result: CompletionQuoteCarry;
  } | null = null;
  return (
    messages: readonly ChatMessage[],
    skip: (message: ChatMessage) => boolean,
  ): CompletionQuoteCarry => {
    let kept = 0;
    if (previous) {
      const shared = Math.min(messages.length, previous.messages.length);
      while (kept < shared && messages[kept] === previous.messages[kept]) kept += 1;
      if (kept === messages.length && kept === previous.messages.length) return previous.result;
    }
    let settled = -1;
    for (let at = kept - 1; at >= 0; at -= 1) {
      const message = messages[at]!;
      if (skip(message)) continue;
      if (message.role !== "assistant" || messageHasText(message)) {
        settled = at;
        break;
      }
    }
    const carried = (previous?.carried ?? []).filter((entry) => entry.at <= settled);
    const forwarded = (previous?.forwarded ?? []).filter((entry) => entry.at <= settled);
    let pending: { ids: string[]; quotes: CompletionQuote[] } = { ids: [], quotes: [] };
    for (let at = settled + 1; at < messages.length; at += 1) {
      const message = messages[at]!;
      if (skip(message)) continue;
      if (message.role !== "assistant") {
        pending = { ids: [], quotes: [] };
        continue;
      }
      if (messageHasText(message)) {
        if (pending.quotes.length > 0) {
          carried.push({ at, id: message.id, quotes: pending.quotes });
          for (const id of pending.ids) forwarded.push({ at, id });
        }
        pending = { ids: [], quotes: [] };
        continue;
      }
      const quotes = messageCompletionQuotes(message);
      if (quotes.length > 0) {
        pending = {
          ids: [...pending.ids, message.id],
          quotes: [...pending.quotes, ...quotes],
        };
      }
    }
    const result: CompletionQuoteCarry = {
      carried: new Map(carried.map((entry) => [entry.id, entry.quotes])),
      forwarded: new Set(forwarded.map((entry) => entry.id)),
    };
    previous = { messages, carried, forwarded, result };
    return result;
  };
};

export const ChatMessageRow = memo(function ChatMessageRow({
  item,
  conversationId,
  styles,
  colors,
  animate,
  menuActive,
  isSelecting,
  anySelecting,
  actions: {
    onOpenArtifact,
    onOpenStellaFile,
    onOpenMessageMenu,
    onEndSelecting,
    onAskStella,
    onOpenReply,
    onOpenReport,
  },
  contextRef,
  contextStatus,
  desktopAccess,
  menuClone = false,
  receiptLabel,
  carriedQuotes,
  quotesForwarded = false,
  hideAgentChips = false,
}: {
  item: ChatMessage;
  conversationId: string;
  styles: MessageRowStyles;
  colors: Colors;
  animate: boolean;
  menuActive: boolean;
  isSelecting: boolean;
  anySelecting: boolean;
  actions: MessageRowActions;
  contextRef?: ReplyRef;
  contextStatus?: ReplyAgentStatus;
  desktopAccess?: StoredPhoneAccess | null;
  menuClone?: boolean;
  receiptLabel?: string | null;
  carriedQuotes?: CompletionQuote[];
  quotesForwarded?: boolean;
  hideAgentChips?: boolean;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const bubbleRef = useRef<View>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHold = () => {
    if (holdTimerRef.current === null) return;
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };
  useEffect(
    () => () => {
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
    },
    [],
  );
  const pressIn = () => {
    cancelHold();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      Animated.timing(pressScale, {
        toValue: MESSAGE_PRESS_SCALE,
        duration: MESSAGE_LONG_PRESS_MS - MESSAGE_HOLD_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, MESSAGE_HOLD_MS);
  };
  const pressOut = () => {
    cancelHold();
    pressScale.stopAnimation();
    Animated.spring(pressScale, {
      toValue: 1,
      stiffness: 420,
      damping: 30,
      useNativeDriver: true,
    }).start();
  };
  const pressStyle = useMemo(
    () => ({ transform: [{ scale: pressScale }] }),
    [pressScale],
  );
  const openMenu = () => {
    if (!item.text.trim()) return;
    const bubble = bubbleRef.current;
    if (!bubble) return;
    bubble.measureInWindow((x, y, width, height) => {
      tapMedium();
      onOpenMessageMenu({ message: item, anchor: { x, y, width, height } });
    });
  };

  const consolidated = messageRowArtifacts(item);
  const completionQuotes = useMemo(
    () => rowCompletionQuotes(consolidated.agentWork),
    [consolidated.agentWork],
  );
  const relayedQuotes = useMemo(
    () => [
      ...(quotesForwarded ? [] : completionQuotes),
      ...(carriedQuotes ?? []),
    ],
    [completionQuotes, quotesForwarded, carriedQuotes],
  );
  const evidencePaths = useMemo(() => {
    if (item.role !== "assistant") return [];
    const paths: string[] = [];
    for (const artifact of consolidated.looseFiles) {
      if (
        artifact.payload.kind === "media" &&
        artifact.payload.asset.kind === "image"
      ) {
        continue;
      }
      const filePath = artifactAttachmentTarget(artifact.payload);
      if (filePath) paths.push(filePath);
    }
    paths.push(...extractFileLinkTargets(item.text ?? ""));
    return paths;
  }, [consolidated.looseFiles, item.role, item.text]);
  const evidenceStripPaths = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const filePath of evidencePaths) {
      const drivePath = driveLinkPath(filePath);
      const key = drivePath ?? filePath;
      if (!byKey.has(key) || drivePath) byKey.set(key, filePath);
    }
    return [...byKey.values()];
  }, [evidencePaths]);
  const scheduleReceipts = useMemo(() => {
    const receipts: { id: string; text: string }[] = [];
    for (const step of item.toolSteps ?? []) {
      if (step.toolName.toLowerCase() !== "schedule") continue;
      if (step.status === "error") continue;
      const text = scheduleReceiptText({ resultPreview: step.resultPreview });
      if (text) receipts.push({ id: step.id, text });
    }
    return receipts;
  }, [item.toolSteps]);
  const bodyText = useMemo(() => {
    const text =
      item.role === "assistant" ? presentAssistantText(item.text) : item.text;
    return evidencePaths.length > 0
      ? unlinkLocalFileLinks(text, evidencePaths)
      : text;
  }, [item.role, item.text, evidencePaths]);
  const hasText = bodyText.trim().length > 0;
  const linkedAppSlugs = useMemo(
    () =>
      item.role === "assistant" ? extractStellaAppLinkSlugs(item.text) : [],
    [item.role, item.text],
  );
  const boundedAssistantBubble = useMemo(
    () =>
      item.role === "assistant" && assistantBubbleNeedsBoundedWidth(item.text),
    [item.role, item.text],
  );
  const mountedEmptyRef = useRef(!hasText);

  if (item.role === "user") {
    const thumbs = item.thumbnailUris ?? [];
    const attachmentPreviews = item.attachmentPreviews ?? [];
    const showThumbs = thumbs.length > 0;
    const documentNames = item.documentNames ?? [];
    const showText = item.text.trim().length > 0;
    const quotedText = item.quotedText?.trim();
    const pastedTexts = item.pastedTexts ?? [];
    const imageUris: { key: string; uri: string; name?: string; path?: string }[] =
      attachmentPreviews.length > 0
        ? attachmentPreviews.flatMap((preview) =>
            preview.imageUri
              ? [{ key: preview.path, uri: preview.imageUri, name: preview.name, path: preview.path }]
              : [],
          )
        : thumbs.map((uri) => ({ key: uri, uri }));
    const fileEntries: { name: string; path?: string }[] =
      attachmentPreviews.length > 0
        ? attachmentPreviews
            .filter((preview) => !preview.imageUri)
            .map((preview) => ({ name: preview.name, path: preview.path }))
        : documentNames.map((name) => ({ name }));
    const fileNames = fileEntries.map((entry) => entry.name);
    const attachmentLink = (path: string) =>
      driveLinkPath(path) || /^(?:[/~]|[A-Za-z]:[\\/]|[a-z]+:)/i.test(path)
        ? path
        : driveLinkTarget(path);
    const imageGallery = imageUris.flatMap((image) =>
      image.path ? [attachmentLink(image.path)] : [],
    );
    const openPastedText = (text: string) =>
      onOpenArtifact?.({
        id: `${conversationId}:pasted-text:${item.id}:${text.length}`,
        conversationId,
        payload: { kind: "media", asset: { kind: "text", text }, createdAt: item.createdAt ?? Date.now() },
      });
    const hasAttachmentRow =
      imageUris.length > 0 || fileNames.length > 0 || pastedTexts.length > 0;
    const hasBubbleBody = showText;
    const attachmentTiles: AttachmentTileItem[] = [
      ...imageUris.map((image) => ({
        key: `image-${image.key}`,
        node: (
          <ImageTile
            uri={image.uri}
            name={image.name}
            colors={colors}
            onPress={
              image.path && onOpenStellaFile
                ? () => onOpenStellaFile(attachmentLink(image.path!), imageGallery)
                : undefined
            }
          />
        ),
      })),
      ...fileEntries.map((entry, index) => ({
        key: `file-${index}-${entry.name}`,
        node: (
          <FileTile
            name={fileDisplayName(entry.name)}
            colors={colors}
            onPress={
              entry.path && onOpenStellaFile
                ? () => onOpenStellaFile(attachmentLink(entry.path!))
                : undefined
            }
          />
        ),
      })),
      ...pastedTexts.map((pasted, index) => ({
        key: `pasted-${index}`,
        node: (
          <PastedTextTile
            text={pasted.text ?? ""}
            colors={colors}
            onPress={
              pasted.text && onOpenArtifact && !menuClone
                ? () => openPastedText(pasted.text!)
                : undefined
            }
          />
        ),
      })),
    ];
    const attachmentRow = hasAttachmentRow ? (
      <AttachmentTileRow
        items={attachmentTiles}
        align="end"
        colors={colors}
        style={[
          styles.userAttachmentRow,
          showText || quotedText ? styles.userAttachmentRowAbove : null,
        ]}
      />
    ) : null;
    const userBubbleBody = showText ? (
      <UserMessageText text={item.text} styles={styles} />
    ) : null;
    if (menuClone) {
      return <View style={styles.userBubble}>{userBubbleBody}</View>;
    }
    return (
      <View>
        {attachmentRow}
        <View style={styles.userRow}>
          <View style={styles.userColumn}>
            {quotedText ? (
              <View style={[styles.quoteChip, styles.userQuoteChip]}>
                <Icon
                  name="quote"
                  size={13}
                  color={colors.textMuted}
                  style={styles.quoteChipIcon}
                />
                <Text
                  style={styles.quoteChipText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
                >
                  {quotedText}
                </Text>
              </View>
            ) : null}
            {!hasBubbleBody ? null : isSelecting && showText ? (
              <View style={styles.userBubble}>
                <AssistantTextSelection
                  text={item.text}
                  colors={{ ...colors, text: colors.userBubbleText }}
                  onDismiss={onEndSelecting}
                />
              </View>
            ) : (
              <View
                ref={bubbleRef}
                collapsable={false}
                style={[
                  item.reaction ? styles.userBubbleReacted : null,
                  menuActive ? styles.bubbleHidden : null,
                ]}
              >
                <Animated.View style={pressStyle}>
                  <Pressable
                    onLongPress={openMenu}
                    onPressIn={pressIn}
                    onPressOut={pressOut}
                    onPress={anySelecting ? onEndSelecting : undefined}
                    delayLongPress={MESSAGE_LONG_PRESS_MS}
                    accessibilityHint="Long press for message actions"
                    style={styles.userBubble}
                  >
                    {userBubbleBody}
                  </Pressable>
                </Animated.View>
                {item.reaction ? (
                  <ReactionBadge
                    key={item.reaction}
                    emoji={item.reaction}
                    fresh={
                      item.reactionAt !== undefined &&
                      Date.now() - item.reactionAt < 10_000
                    }
                    styles={styles}
                  />
                ) : null}
              </View>
            )}
            {receiptLabel ? (
              <Text
                style={styles.receipt}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                {receiptLabel}
              </Text>
            ) : null}
            {item.stopped ? (
              <Text
                style={styles.stoppedTag}
                maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
              >
                Stopped
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    );
  }
  const { maps: mapArtifacts, looseFiles } = consolidated;
  const isStandIn = isStandInArtifactRow(item);
  const showMapArtifacts = !isStandIn && mapArtifacts.length > 0;
  const generatedImages = looseFiles.filter(
    (artifact) =>
      artifact.payload.kind === "media" &&
      artifact.payload.asset.kind === "image",
  );
  const showGeneratedImages = !isStandIn && generatedImages.length > 0;
  const showEvidence = !isStandIn && evidencePaths.length > 0;
  const showArtifacts =
    showMapArtifacts ||
    (showGeneratedImages && !hasText) ||
    linkedAppSlugs.length > 0;
  const quotedThreadIds = new Set(
    [...completionQuotes, ...relayedQuotes].map((quote) => quote.ref.threadId),
  );
  const generatedImageCards = showGeneratedImages
    ? generatedImages.map((artifact) => (
        <GeneratedImageCard
          key={artifact.id}
          artifact={artifact}
          access={desktopAccess ?? undefined}
          colors={colors}
          onPress={onOpenArtifact}
        />
      ))
    : null;
  const evidenceMedia = showEvidence ? (
    <MessageEvidenceStrip
      filePaths={evidenceStripPaths}
      conversationId={conversationId}
      access={desktopAccess ?? null}
      colors={colors}
      onOpen={onOpenStellaFile}
      part={hasText ? "media" : undefined}
      style={hasText ? styles.mediaBelowBubble : undefined}
    />
  ) : null;
  const evidenceDocuments =
    showEvidence && hasText ? (
      <MessageEvidenceStrip
        filePaths={evidenceStripPaths}
        conversationId={conversationId}
        access={desktopAccess ?? null}
        colors={colors}
        onOpen={onOpenStellaFile}
        part="documents"
        style={styles.bubbleEvidence}
      />
    ) : null;
  const reportRefs: AgentReplyRef[] = [
    ...new Map(
      [
        ...relayedQuotes.map((quote) => quote.ref),
        ...(contextRef?.kind === "agent" &&
        !quotedThreadIds.has(contextRef.threadId) &&
        contextStatus !== "running"
          ? [contextRef]
          : []),
      ].map((ref) => [ref.threadId, ref] as const),
    ).values(),
  ];
  const showMore =
    onOpenReport && reportRefs.length > 0
      ? {
          label: `Full report: ${reportRefs.map(replyTitle).join(", ")}`,
          onPress: (anchor?: ReportAnchor) => onOpenReport(reportRefs, anchor),
        }
      : undefined;
  const fillAssistantBubble = boundedAssistantBubble;
  const assistantBubble = (
    <AssistantBubble
      style={[
        styles.assistantBubble,
        fillAssistantBubble && styles.assistantBlockBubble,
      ]}
      animate={!menuClone && (animate || mountedEmptyRef.current)}
    >
      <AssistantMarkdown
        text={bodyText}
        colors={colors}
        fill={boundedAssistantBubble}
        onStellaFileLink={onOpenStellaFile}
        showMore={showMore}
      />
      {evidenceDocuments}
    </AssistantBubble>
  );
  if (menuClone) return assistantBubble;
  return (
    <View style={styles.assistantRow}>
      {onOpenReply && !hideAgentChips
        ? completionQuotes.map((quote) => (
            <ReplyPreview
              key={quote.key}
              reference={quote.ref}
              status={
                contextRef?.kind === "agent" &&
                contextRef.threadId === quote.ref.threadId
                  ? contextStatus
                  : "completed"
              }
              colors={colors}
              onOpen={() => onOpenReply(quote.ref)}
            />
          ))
        : null}
      {contextRef &&
      onOpenReply &&
      !(contextRef.kind === "agent" && hideAgentChips) &&
      !(
        contextRef.kind === "agent" && quotedThreadIds.has(contextRef.threadId)
      ) ? (
        <ReplyPreview
          reference={contextRef}
          status={contextStatus}
          colors={colors}
          onOpen={() => onOpenReply(contextRef)}
        />
      ) : null}
      {item.askRecords?.map((record) => (
        <View key={record.id} style={hasText ? styles.askRecordAbove : undefined}>
          <UserAskRecordView record={record} />
        </View>
      ))}
      {item.scheduleNotice ? <ScheduleNoticeCard card={item.scheduleNotice} colors={colors} /> : null}
      {hasText && isSelecting ? (
        <View style={[styles.assistantBubble, styles.assistantSelectBubble]}>
          <AssistantTextSelection
            text={extractPlainText(item.text).trim()}
            colors={{ ...colors, text: colors.assistantBubbleText }}
            onAskStella={onAskStella}
            onDismiss={onEndSelecting}
          />
        </View>
      ) : hasText ? (
        <View
          ref={bubbleRef}
          collapsable={false}
          style={[
            fillAssistantBubble
              ? styles.assistantBubbleSlotFill
              : styles.assistantBubbleSlot,
            menuActive && styles.bubbleHidden,
          ]}
        >
          <Animated.View style={pressStyle}>
            <Pressable
              onLongPress={openMenu}
              onPressIn={pressIn}
              onPressOut={pressOut}
              onPress={anySelecting ? onEndSelecting : undefined}
              delayLongPress={MESSAGE_LONG_PRESS_MS}
              accessibilityHint="Long press for message actions"
            >
              {assistantBubble}
            </Pressable>
          </Animated.View>
        </View>
      ) : null}
      {item.reminder ? <ReminderActions mark={item.reminder} colors={colors} /> : null}
      {hasText && (showGeneratedImages || showEvidence) ? (
        <View>
          {showGeneratedImages ? (
            <View style={[styles.artifactGroup, styles.mediaBelowBubble]}>
              {generatedImageCards}
            </View>
          ) : null}
          {evidenceMedia}
        </View>
      ) : null}
      {scheduleReceipts.map((receipt) => (
        <Text
          key={receipt.id}
          style={styles.scheduleReceipt}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          {receipt.text}
        </Text>
      ))}
      {showArtifacts ? (
        <View
          style={[styles.artifactGroup, hasText && styles.artifactGroupSpaced]}
        >
          {/* Running agents surface in the top bar's status mark, not as
              transcript rows; finished ones arrive as quotes above replies. */}
          {linkedAppSlugs.map((slug) => (
            <AppPreviewCard key={`app:${slug}`} slug={slug} colors={colors} />
          ))}
          {showMapArtifacts
            ? mapArtifacts.map((artifact) => (
                <MapRouteCard
                  key={artifact.id}
                  payload={artifact.payload}
                  colors={colors}
                />
              ))
            : null}
          {hasText ? null : generatedImageCards}
        </View>
      ) : null}
      {hasText ? null : evidenceMedia}
      {/* A stopped reply already says so in its own bubble ("Stopped."). */}
      {item.cloudFallback ? (
        <Text
          style={styles.cloudTag}
          maxFontSizeMultiplier={CONTENT_MAX_FONT_SCALE}
        >
          Answered while your computer was offline
        </Text>
      ) : null}
    </View>
  );
});

export const makeMessageRowStyles = (colors: Colors) =>
  StyleSheet.create({
    userRow: { flexDirection: "row", justifyContent: "flex-end" },
    userColumn: { alignItems: "flex-end", maxWidth: "92%" },
    userBubble: {
      backgroundColor: colors.userBubbleFill,
      borderRadius: 18,
      borderCurve: "continuous",
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    bubbleHidden: { opacity: 0 },
    userBubbleReacted: { marginTop: 14 },
    reactionBadge: {
      position: "absolute",
      top: -14,
      left: -12,
      minWidth: 28,
      height: 28,
      paddingHorizontal: 5,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderColor: colors.background,
      borderWidth: 2,
    },
    reactionBadgeText: { fontSize: 15, lineHeight: 19 },
    receipt: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 12,
      letterSpacing: -0.1,
      marginRight: 6,
      marginTop: 4,
    },
    stoppedTag: {
      color: colors.textMuted,
      fontFamily: fonts.sans.medium,
      fontSize: 11,
      letterSpacing: 0.4,
      marginTop: 6,
      textTransform: "uppercase",
    },
    cloudTag: {
      color: colors.textMuted,
      fontFamily: fonts.sans.regular,
      fontSize: 12,
      letterSpacing: -0.1,
      marginTop: 6,
      opacity: 0.8,
    },
    userText: {
      color: colors.userBubbleText,
      fontFamily: fonts.sans.regular,
      fontSize: 17,
      letterSpacing: 0.03 * 17,
      lineHeight: 17 * 1.52,
    },
    userToggle: {
      alignSelf: "flex-end",
      color: fadeHex(colors.userBubbleText, 0.68),
      fontFamily: fonts.sans.medium,
      fontSize: 13,
      letterSpacing: -0.1,
      lineHeight: 16,
      marginTop: 6,
    },
    userTogglePressed: {
      color: colors.text,
    },
    userAttachmentRow: { alignSelf: "flex-end", maxWidth: "92%" },
    userAttachmentRowAbove: { marginBottom: 6 },
    assistantRow: { paddingVertical: ASSISTANT_ROW_PAD_VERTICAL },
    askRecordAbove: { marginBottom: 6 },
    assistantBubble: {
      alignSelf: "flex-start",
      overflow: "hidden",
      borderRadius: 18,
      borderCurve: "continuous",
      maxWidth: "100%",
      paddingBottom: 0,
      paddingHorizontal: 14,
      paddingTop: 9,
    },
    assistantBubbleSlot: { alignSelf: "flex-start", maxWidth: "100%" },
    assistantBubbleSlotFill: { alignSelf: "stretch" },
    assistantSelectBubble: {
      backgroundColor: colors.assistantBubbleFillBottom,
      paddingBottom: 10,
    },
    assistantBlockBubble: { alignSelf: "stretch" },
    scheduleReceipt: {
      color: colors.text,
      fontFamily: fonts.sans.regular,
      fontSize: 14,
      letterSpacing: -0.1,
      lineHeight: 20,
      marginTop: 6,
    },
    artifactGroup: { gap: 10 },
    bubbleEvidence: { marginTop: 0, marginBottom: 12 },
    mediaBelowBubble: { marginTop: 6 },
    artifactGroupSpaced: { marginTop: 10 },
    quoteChip: {
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 6,
      maxWidth: "100%",
      paddingLeft: 10,
      paddingRight: 6,
      paddingVertical: 6,
    },
    quoteChipIcon: { opacity: 0.8 },
    quoteChipText: {
      color: colors.textMuted,
      flexShrink: 1,
      fontFamily: fonts.sans.regular,
      fontSize: 13,
      letterSpacing: -0.1,
    },
    userQuoteChip: {
      alignSelf: "flex-end",
      marginBottom: 6,
    },
  } as const);
