import { Fragment, memo, useId, useMemo, useState, type ReactNode } from "react";
import { serverNow } from "@stella/contracts/server-clock";
import { EMAIL_PAGE_CANVAS } from "@stella/contracts/email-page";
import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import { dropAttachmentOnlyLines, extractFileLinkTargets } from "@stella/contracts/local-file-links";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { replyAttachmentPlacement } from "@stella/contracts/reply-attachments";
import { isHtmlPagePath } from "@stella/contracts/page-preview";
import { presentAssistantText } from "@stella/contracts/assistant-internal-text";
import { extractStellaAppLinkSlugs } from "@stella/contracts/workspace-apps";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import { useEntrance } from "@/features/chat/lib/message-entry-animation-state";
import { pastedTextPreview, type PastedTextDescriptor } from "@/features/chat/lib/paste-context";
import type { Attachment, ChannelEnvelope } from "@/features/chat/lib/event-transforms";
import { localFilePathForPayload } from "@/features/workspace-display/path-to-viewer";
import type { ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import { evidenceCardDrivePath, useDriveEvidenceCards } from "@/features/chat/hooks/use-drive-evidence-cards";
import { sanitizeAttachmentImageUrl } from "@/shared/lib/url-safety";
import { useMessageReply } from "@/app/chat/message-reply-context";
import { useReplyHandoffController } from "@/app/chat/reply-handoff";
import { truncateChipLabel } from "@/features/chat/composer-context";
import { primaryCopyAttachment } from "@/app/chat/message-copy-attachment";
import { messageMenu } from "@/app/chat/message-context-menu";
import { contextMenu } from "./context-menu";
import { useT } from "@/shared/i18n";
import { eventRowEqual } from "@/features/chat/lib/row-equality";
import { assistantRowHasVisibleContent, shownAgentLabelIds } from "@/features/chat/lib/assistant-row-content";
import type { AssistantRowViewModel, UserRowViewModel } from "@/features/chat/conversation-row-types";
import { derive, fontSize, radius, useTokens } from "../theme";
import { ContextPill, FileAttachmentChip, ImageAttachmentChip, fileAttachmentTypeLabelKey } from "./ComposerContextChips";
import { AttachmentTileRow, PastedTextTile, type AttachmentTileItem } from "./AttachmentTiles";
import { ChipPreview, useHoverPreview } from "./HoverPreview";
import { ChatTextColor, useChatSurfaceLook } from "./chat-text";
import { Markdown } from "./Markdown";
import { MessageActions } from "./MessageActions";
import { UserMessageBody } from "./UserMessageBody";
import { isBrowserUploadId, SendFailedMark, SendPendingMark, UploadFailedMark } from "./SendFailureMarks";
import { ReplyPreview } from "./ReplyPreview";
import { UserAskRecordCard } from "./UserAskRecordCard";
import { VoiceSessionCard } from "./VoiceSessionCard";
import { ScheduleNotices } from "./cards/ScheduleNotices";
import { ReminderFireCard } from "./cards/ReminderFireCard";
import { MessageAttachments } from "./evidence/MessageAttachments";
import { FilePills } from "./FilePills";
import { AppPreviewCard } from "./cards/AppPreviewCard";
import { AgentUpdateCard } from "@/features/app-source/AppSourceCards";
import { MapRouteCards } from "./cards/MapRouteCard";
import { OfficePreviewCard } from "./cards/OfficePreviewCard";
import { InlineGeneratedImageStrip } from "./cards/InlineGeneratedImageCard";
import { SourceDiffEndResource } from "./cards/SourceDiffEndResource";
import { previewCard, pillColors } from "./surfaces";


type Translate = ReturnType<typeof useT>;

export const PART_GAP = 8;
const MESSAGE_ENTRANCE_MS = 360;
const MESSAGE_ENTRANCE_ANIMATION = "bubble-pop";
const BUBBLE_MAX_FRACTION = 0.85;
const CHIP_GAP = 6;

const getAttachmentLabel = (attachment: Attachment, index: number, t: Translate) => {
  if (attachment.name) return attachment.name;
  if (attachment.kind) {
    const normalized = attachment.kind.replace(/[_-]+/g, " ").trim();
    if (normalized.length > 0) return normalized[0]!.toUpperCase() + normalized.slice(1);
  }
  if (attachment.mimeType) return attachment.mimeType;
  return t("app.chat.messageRow.attachmentFallback", { index: index + 1 });
};

const IMAGE_FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif)$/i;

const isImageAttachment = (attachment: Attachment, safeUrl: string): boolean => {
  if (attachment.kind === "file") return false;
  const mimeType = attachment.mimeType?.trim().toLowerCase();
  if (mimeType) return mimeType.startsWith("image/");
  if (safeUrl.startsWith("data:")) return /^data:image\//i.test(safeUrl);
  if (attachment.name && /\.[a-z0-9]+$/i.test(attachment.name)) return IMAGE_FILE_EXT_RE.test(attachment.name);
  return true;
};

const getFileAttachmentName = (attachment: Attachment, t: Translate): string => {
  if (attachment.name) return attachment.name;
  if (attachment.kind && attachment.kind !== "file") {
    const normalized = attachment.kind.replace(/[_-]+/g, " ").trim();
    if (normalized.length > 0) return normalized[0]!.toUpperCase() + normalized.slice(1);
  }
  return t(fileAttachmentTypeLabelKey(attachment.mimeType));
};

const formatChannelKind = (kind: ChannelEnvelope["kind"], t: Translate) => {
  if (kind === "message") return t("app.chat.messageRow.channelKind.message");
  if (kind === "reaction") return t("app.chat.messageRow.channelKind.reaction");
  if (kind === "edit") return t("app.chat.messageRow.channelKind.edited");
  if (kind === "delete") return t("app.chat.messageRow.channelKind.deleted");
  return t("app.chat.messageRow.channelKind.system");
};

const formatProvider = (provider: string) =>
  provider
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");

const summarizeReactions = (envelope: ChannelEnvelope, t: Translate): string | null => {
  const reactions = envelope.reactions ?? [];
  if (reactions.length === 0) return null;
  const labels = reactions.slice(0, 3).map((reaction) => `${reaction.action === "remove" ? "-" : "+"}${reaction.emoji}`);
  const suffix = reactions.length > 3 ? ` +${reactions.length - 3}` : "";
  return t("app.chat.messageRow.reactionsSummary", { reactions: `${labels.join(" ")}${suffix}` });
};

/** `.event-channel-badge`: the chip look with text only (provider, kind, reactions). */
function ChannelBadge({ label, weight = 500, upper }: { label: string; weight?: number; upper?: boolean }) {
  const t = useTokens();
  const c = pillColors(t);
  return (
    <box shrink={false} maxW={340} py={4 + 1} px={10 + 1} radius={radius.md} fill={c.fill} border={c.border}>
      <text size={fontSize.sm} weight={weight} lineHeight={15.6} tracking={upper ? fontSize.sm * 0.05 : 0} textCase={upper ? "upper" : undefined} color={c.text} nowrap truncate>
        {label}
      </text>
    </box>
  );
}

function HoverChip({ kind, label, title, children, previewW, previewMaxH, previewPad }: { kind: "window" | "selected-text"; label: string; title?: string; children?: ReactNode; previewW?: number; previewMaxH?: number; previewPad?: [number, number] }) {
  const tokens = useTokens();
  const id = useId();
  const hover = useHoverPreview();
  return (
    <box id={`hover-chip:${id}`} maxW={340} minW={0} onHover={children ? hover.onHover : undefined} onFocus={children ? hover.onFocus : undefined} focusable={Boolean(children)}>
      <ContextPill kind={kind} label={label} title={title} hovered={hover.open} />
      {children ? (
        <ChipPreview anchor={`hover-chip:${id}`} open={hover.open} interactive={kind === "selected-text"} onHover={hover.onHover} w={previewW} maxH={previewMaxH} py={previewPad?.[0]} px={previewPad?.[1]} radius={12} {...previewCard(tokens)}>
          {children}
        </ChipPreview>
      ) : null}
    </box>
  );
}

function UserWindowContextChip({ label, previewImageUrl }: { label: string; previewImageUrl?: string }) {
  const t = useT();
  return (
    <HoverChip kind="window" label={label} previewPad={[6 + 1, 6 + 1]}>
      {previewImageUrl ? <image src={previewImageUrl} maxW={448} maxH={280} fit="contain" radius={radius.md} fill={useTokens().c.surfaceInset} label={t("app.chat.messageRow.windowPreviewAlt")} /> : null}
    </HoverChip>
  );
}

function UserQuotedTextChip({ quotedText }: { quotedText: string }) {
  const t = useT();
  const tokens = useTokens();
  const preview = quotedText.trim();
  const label = truncateChipLabel(preview.replace(/\s+/g, " "), 48);
  return (
    <HoverChip kind="selected-text" label={preview ? `"${label}"` : t("app.chat.messageRow.quotedTextLabel")} title={t("app.chat.messageRow.quotedTextLabel")} previewW={460} previewMaxH={220} previewPad={[12 + 1, 14 + 1]}>
      {preview ? (
        <col scrollY minH={0}>
          <text size={fontSize.sm} lineHeight={18} tracking={fontSize.sm * 0.01} color={tokens.c.textStrong} selectable>
            {preview}
          </text>
        </col>
      ) : null}
    </HoverChip>
  );
}

type ContextChip = { key: string; node: ReactNode };

function UserContextChips({ chips }: { chips: ContextChip[] }) {
  const t = useT();
  const tokens = useTokens();
  const id = useId();
  const [columnW, setColumnW] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [overflowW, setOverflowW] = useState(36);
  const hover = useHoverPreview();
  const c = pillColors(tokens);
  const available = columnW * BUBBLE_MAX_FRACTION;
  let visibleCount = chips.length;
  if (columnW > 0 && chips.length > 1 && chips.every((chip) => widths[chip.key])) {
    const total = chips.reduce((sum, chip, index) => sum + widths[chip.key]! + (index > 0 ? CHIP_GAP : 0), 0);
    if (total > available) {
      const reserve = overflowW + CHIP_GAP;
      let used = 0;
      let count = 0;
      for (let index = 0; index < chips.length; index += 1) {
        const width = widths[chips[index]!.key]! + (index > 0 ? CHIP_GAP : 0);
        if (used + width + reserve <= available) {
          used += width;
          count += 1;
        } else break;
      }
      visibleCount = Math.max(1, count);
    }
  }
  const hidden = chips.slice(visibleCount);
  return (
    <row w="full" justify="end" align="center" gap={CHIP_GAP} minW={0} onLayout={(r) => setColumnW(r.w)}>
      {chips.map((chip, index) => (
        <box
          key={chip.key}
          shrink={false}
          absolute={index >= visibleCount ? { left: 0, top: 0 } : undefined}
          hidden={index >= visibleCount}
          inert={index >= visibleCount}
          onLayout={(r) => setWidths((prev) => (prev[chip.key] === Math.round(r.w) ? prev : { ...prev, [chip.key]: Math.round(r.w) }))}
        >
          {chip.node}
        </box>
      ))}
      {hidden.length > 0 ? (
        <>
          <box
            id={`chips-more:${id}`}
            role="button"
            focusable
            label={t("app.chat.messageRow.showMoreChips", { count: hidden.length })}
            shrink={false}
            py={4 + 1}
            px={10 + 1}
            radius={radius.md}
            fill={hover.open ? c.hoverFill : c.fill}
            border={hover.open ? c.hoverBorder : c.border}
            center
            onHover={hover.onHover}
            onFocus={hover.onFocus}
            onLayout={(r) => setOverflowW(Math.round(r.w))}
          >
            <text size={fontSize.sm} weight={600} lineHeight={15.6} features="'tnum' 1" color={c.text}>
              {`+${hidden.length}`}
            </text>
          </box>
          <ChipPreview anchor={`chips-more:${id}`} open={hover.open} align="start" gap={6} pad={8 + 1} radius={12} maxW={360} {...previewCard(tokens)}>
            <col align="start" gap={6}>
              {hidden.map((chip) => (
                <Fragment key={chip.key}>{chip.node}</Fragment>
              ))}
            </col>
          </ChipPreview>
        </>
      ) : null}
    </row>
  );
}

function AttachmentImage({ attachment, index, safeUrl }: { attachment: Attachment; index: number; safeUrl: string }) {
  const t = useT();
  const label = getAttachmentLabel(attachment, index, t);
  return <ImageAttachmentChip thumbnailUrl={safeUrl} fullImageUrl={safeUrl} alt={attachment.name ?? t("app.chat.messageRow.attachmentAlt")} title={t("app.chat.messageRow.clickToEnlarge", { label })} />;
}

/** The `bubble-pop` entrance: rise 14pt and grow from 84% on a 360ms spring, fading in over 120ms. */
const bubblePop = (delayMs: number | null) => (delayMs === null ? undefined : { opacity: 0, y: 14, scale: 0.84, dur: MESSAGE_ENTRANCE_MS / 1000, bounce: 0.15 });

const reactionLook = (t: ReturnType<typeof useTokens>) => derive(t, "reaction", (k) => ({ fill: k.c.surfaceInset, border: k.c.background }));

export const UserMessageRow = memo(
  function UserMessageRow({ row }: { row: UserRowViewModel }) {
    const t = useT();
    const tokens = useTokens();
    const surface = useChatSurfaceLook();
    const entrance = useEntrance(row.arrivedAt, MESSAGE_ENTRANCE_MS, MESSAGE_ENTRANCE_ANIMATION);
    const reply = useMessageReply();
    const { text, windowLabel, attachments, channelEnvelope } = row;
    const copyAttachment = useMemo(() => primaryCopyAttachment(attachments), [attachments]);
    const appSelectionLabels = (row.appSelectionLabels ?? []).map((label) => label.trim()).filter((label) => label.length > 0);
    const activityLabel = row.activityLabel?.trim();
    const pastedTexts: PastedTextDescriptor[] = row.pastedTexts ?? [];
    const windowPreviewImageUrl = sanitizeAttachmentImageUrl(row.windowPreviewImageUrl);
    const reactionSummary = channelEnvelope ? summarizeReactions(channelEnvelope, t) : null;
    const chips: ContextChip[] = [];
    const imageTiles: AttachmentTileItem[] = [];
    const fileTiles: AttachmentTileItem[] = [];
    attachments.forEach((attachment, index) => {
      const safeUrl = sanitizeAttachmentImageUrl(attachment.url);
      const key = attachment.id ?? `attachment-${index}`;
      const withUploadMark = (node: ReactNode) =>
        isBrowserUploadId(attachment.id) ? (
          <box>
            {node}
            <UploadFailedMark uploadId={attachment.id} />
          </box>
        ) : (
          node
        );
      if (safeUrl && isImageAttachment(attachment, safeUrl)) {
        imageTiles.push({ key, node: withUploadMark(<AttachmentImage attachment={attachment} index={index} safeUrl={safeUrl} />) });
        return;
      }
      fileTiles.push({ key, node: withUploadMark(<FileAttachmentChip name={getFileAttachmentName(attachment, t)} size={attachment.size} mimeType={attachment.mimeType} path={attachment.path} />) });
    });
    if (windowLabel) chips.push({ key: "window", node: <UserWindowContextChip label={windowLabel} previewImageUrl={windowPreviewImageUrl ?? undefined} /> });
    const emailPrefix = t("email.brief.chip", { title: "" });
    appSelectionLabels.forEach((label, index) => {
      chips.push({ key: `app-selection-${index}`, node: <ContextPill kind={label.startsWith(emailPrefix) ? "email" : "app-selection"} label={label} /> });
    });
    if (row.canvasAction) chips.push({ key: "canvas-action", node: <ContextPill kind={row.canvasAction.canvas === EMAIL_PAGE_CANVAS ? "email" : "canvas"} label={row.canvasAction.chip} /> });
    if (activityLabel) chips.push({ key: "activity", node: <ContextPill kind="activity" label={activityLabel} /> });
    if (row.quotedText?.trim()) chips.push({ key: "quoted-text", node: <UserQuotedTextChip quotedText={row.quotedText} /> });
    if (channelEnvelope?.provider) chips.push({ key: "channel-provider", node: <ChannelBadge label={formatProvider(channelEnvelope.provider)} weight={600} /> });
    if (channelEnvelope && channelEnvelope.kind !== "message") chips.push({ key: "channel-kind", node: <ChannelBadge label={formatChannelKind(channelEnvelope.kind, t)} upper /> });
    if (channelEnvelope && reactionSummary) chips.push({ key: "channel-reaction", node: <ChannelBadge label={reactionSummary} /> });
    const tiles: AttachmentTileItem[] = [...imageTiles, ...fileTiles];
    pastedTexts.forEach((descriptor, index) => {
      tiles.push({ key: `pasted-text-${index}`, node: <PastedTextTile text={descriptor.text ?? ""} preview={pastedTextPreview(descriptor)} label={t("app.chat.messageRow.pastedTextLabel")} /> });
    });
    const reaction = row.reaction;
    const freshReaction = Boolean(reaction && row.reactionAt && serverNow() - row.reactionAt < 10_000);
    return (
      <col
        w="full"
        gap={PART_GAP}
        hoverGroup
        onContextMenu={contextMenu(messageMenu({ text, messageKey: row.id, copyAttachment, onReply: reply, sendFailed: Boolean(row.sendFailed) }))}
      >
        {chips.length > 0 ? <UserContextChips chips={chips} /> : null}
        <AttachmentTileRow items={tiles} align="end" maxW="85%" />
        {text.trim() || chips.length > 0 || tiles.length > 0 ? (
          <row w="full" minW={0} justify="end" align="start" gap={4}>
            <MessageActions text={text} messageKey={row.id} align="end" timestampMs={row.timestampMs} copyAttachment={copyAttachment ?? undefined} onReply={reply ?? undefined} />
            {text.trim() ? (
              <col
                maxW={surface.user.maxW}
                minW={0}
                w="fit"
                mt={reaction ? 14 : 0}
                py={surface.user.py}
                px={surface.user.px}
                radius={surface.user.radius}
                fill={tokens.c.chatUserBubbleFill}
                origin={[1, 1]}
                enter={bubblePop(entrance.delayMs)}
              >
                {reaction ? (
                  <box
                    key={reaction}
                    absolute={{ top: -14, left: -12 }}
                    raise
                    minW={28}
                    h={28}
                    px={5}
                    center
                    radius={radius.full}
                    fill={reactionLook(tokens).fill}
                    border={reactionLook(tokens).border}
                    borderWidth={2}
                    shadow={[1, 3, "#0000001f"]}
                    role="img"
                    label={t("app.chat.messageRow.stellaReaction", { emoji: reaction })}
                    title={t("app.chat.messageRow.stellaReaction", { emoji: reaction })}
                    enter={freshReaction ? { opacity: 0, scale: 0.4, dur: 0.32, bounce: 0.15 } : undefined}
                  >
                    <text size={15} lineHeight={15}>
                      {reaction}
                    </text>
                  </box>
                ) : null}
                <ChatTextColor.Provider value={tokens.c.chatUserBubbleText}>
                  <UserMessageBody text={text} />
                </ChatTextColor.Provider>
              </col>
            ) : null}
          </row>
        ) : null}
        {row.sendFailed ? <SendFailedMark clientMsgId={row.id} reason={row.sendFailed} /> : row.sendPending ? <SendPendingMark state={row.sendPending} sinceMs={row.timestampMs ?? null} /> : null}
      </col>
    );
  },
  (prev, next) => eventRowEqual(prev.row, next.row),
);

/** desktop-ui's `useReplyHandoffArrival`: a final reply that just landed takes the working indicator's place. */
function useReplyArrival(justArrived: boolean, finalAnswer: boolean) {
  const controller = useReplyHandoffController();
  const [announced, setAnnounced] = useState(false);
  if (!announced && justArrived && finalAnswer && controller) {
    setAnnounced(true);
    queueMicrotask(() => controller.replyArrived());
  }
}

export const AssistantMessageRow = memo(
  function AssistantMessageRow({ row, conversationId, latestMedia = false }: { row: AssistantRowViewModel; conversationId?: string | null; latestMedia?: boolean }) {
    const tokens = useTokens();
    const surface = useChatSurfaceLook();
    const reply = useMessageReply();
    const entrance = useEntrance(row.arrivedAt, MESSAGE_ENTRANCE_MS, MESSAGE_ENTRANCE_ANIMATION);
    useReplyArrival(entrance.delayMs !== null, !row.isIntraTurn);
    const text = row.text;
    const hasText = text.trim().length > 0;
    const hasMapArtifacts = (row.mapArtifacts?.length ?? 0) > 0;
    const labelIds = shownAgentLabelIds(row);
    const pillCompletions = [...new Map((row.agentCompletion?.sections ?? []).filter((section) => labelIds.includes(section.agentId)).map((section) => [section.agentId, section] as const)).values()];
    const pillRefs: ReplyRef[] = [
      ...(row.replyRefs ?? []).filter((ref) => ref.kind === "message"),
      ...labelIds
        .filter((threadId) => !pillCompletions.some((section) => section.agentId === threadId))
        .map(
          (threadId): ReplyRef => ({
            kind: "agent",
            threadId,
            title:
              row.backgroundWork?.descriptions?.[threadId] ??
              row.replyRefs?.find((ref): ref is Extract<ReplyRef, { kind: "agent" }> => ref.kind === "agent" && ref.threadId === threadId)?.title ??
              "",
          }),
        ),
    ];
    const linkedFiles = row.linkedFiles ?? [];
    const linkTargets = hasText ? extractFileLinkTargets(text) : [];
    const resourcePayload = row.resourcePayload;
    const canvasPage = resourcePayload?.kind === "canvas-html" && isHtmlPagePath(resourcePayload.filePath) ? resourcePayload : null;
    const canvasDrivePath = canvasPage?.driveBacked ? canvasPage.filePath.replace(/^\/+/, "") : null;
    const canvasLocalPath = canvasPage && !canvasPage.driveBacked ? canvasPage.filePath : null;
    const evidencePaths = [...new Set([...linkTargets.filter((target) => !driveLinkPath(target)), ...(canvasLocalPath ? [canvasLocalPath] : [])])];
    const evidencePathSet = new Set(evidencePaths);
    const linkedDrivePaths = [
      ...new Set([
        ...linkTargets.flatMap((target) => {
          const drivePath = driveLinkPath(target);
          return drivePath ? [drivePath] : [];
        }),
        ...(canvasDrivePath ? [canvasDrivePath] : []),
      ]),
    ];
    const driveCards = useDriveEvidenceCards(linkedDrivePaths.filter((drivePath) => replyAttachmentPlacement(drivePath) === "media"));
    const previewedDrivePaths = new Set(
      driveCards.flatMap((card) => {
        const drivePath = evidenceCardDrivePath(card);
        return drivePath ? [drivePath] : [];
      }),
    );
    const hasMedia = evidencePaths.length > 0 || driveCards.length > 0;
    const unpreviewableFiles = linkedFiles.filter((file) => file.cloudDriveFile || !evidencePathSet.has(file.path));
    const resourceShownElsewhere =
      !resourcePayload ||
      resourcePayload.kind === "source-diff" ||
      canvasLocalPath !== null ||
      (canvasDrivePath !== null && previewedDrivePaths.has(canvasDrivePath)) ||
      (resourcePayload.kind === "media" && resourcePayload.presentation === "inline-image") ||
      (resourcePayload.kind === "office" && Boolean(row.officePreviewRef));
    const resourceFilePath = resourcePayload && !resourceShownElsewhere ? localFilePathForPayload(resourcePayload) : null;
    const attachedFiles: ConversationFileEntry[] =
      resourcePayload && resourceFilePath
        ? [
            ...unpreviewableFiles,
            { path: resourceFilePath, timestamp: ("createdAt" in resourcePayload ? resourcePayload.createdAt : undefined) ?? row.timestampMs ?? 0, payload: resourcePayload } as ConversationFileEntry,
          ]
        : unpreviewableFiles;
    const fileKey = (file: ConversationFileEntry) => (file.cloudDriveFile ? `cloud:${file.cloudDriveFile.path}` : `local:${file.path}`);
    const replyFiles = attachedFiles.filter(
      (file, index, all) => (file.cloudDriveFile ? !previewedDrivePaths.has(file.cloudDriveFile.path) : !evidencePathSet.has(file.path)) && all.findIndex((other) => fileKey(other) === fileKey(file)) === index,
    );
    const hiddenFileKeys = linkedFiles
      .map(fileKey)
      .concat(evidencePaths.map((filePath) => `local:${filePath}`))
      .concat(linkedDrivePaths.map((drivePath) => `cloud:${drivePath}`));
    const hiddenFileKeySet = new Set(hiddenFileKeys);
    const bodyText = hasText
      ? dropAttachmentOnlyLines(presentAssistantText(text), (filePath) => {
          const drivePath = driveLinkPath(filePath);
          return hiddenFileKeySet.has(`local:${filePath}`) || (drivePath !== null && hiddenFileKeySet.has(`cloud:${drivePath}`));
        })
      : text;
    const hasBody = !row.reminder && bodyText.trim().length > 0;
    const inlineImages = (row.inlineImagePayloads ?? []).filter(
      (payload): payload is Extract<DisplayPayload, { kind: "media" }> => payload.kind === "media" && payload.presentation === "inline-image" && payload.asset.kind === "image",
    );
    const inlineImageStrip = inlineImages.length > 0 ? <InlineGeneratedImageStrip conversationId={conversationId} payloads={inlineImages} /> : null;
    if (!assistantRowHasVisibleContent(row)) return null;
    const menu = contextMenu(messageMenu({ text: hasBody ? text : "", messageKey: row.id, onReply: row.isIntraTurn ? null : reply, readAloud: !row.isIntraTurn }));
    return (
      <col w="full" hoverGroup onContextMenu={menu}>
        <col w="full" gap={PART_GAP} origin={[0, 1]} enter={bubblePop(entrance.delayMs)}>
          {row.voiceSession ? <VoiceSessionCard durationMs={row.voiceSession.durationMs} /> : null}
          {conversationId && (pillRefs.length > 0 || pillCompletions.length > 0) ? <ReplyPreview refs={pillRefs} completions={pillCompletions} conversationId={conversationId} /> : null}
          {row.askRecords?.map((record) => <UserAskRecordCard key={record.id} record={record} />)}
          {row.scheduleNotice ? <ScheduleNotices first={row.scheduleNotice} run={row.scheduleNoticeRun} /> : null}
          {hasBody ? (
            <row w="full" minW={0} align="start" gap={4}>
              <col w="fit" maxW={surface.assistant.maxW} minW={0} gap={PART_GAP} py={surface.assistant.py} px={surface.assistant.px} radius={surface.assistant.radius} fill={tokens.c.chatAssistantBubbleFillTop} gradient={tokens.gradient.assistantBubble}>
                <ChatTextColor.Provider value={tokens.c.chatAssistantBubbleText}>
                  <Markdown text={bodyText} cacheKey={row.cacheKey} hideHorizontalRules hiddenFilePaths={hiddenFileKeys} onContextMenu={menu} />
                  {evidencePaths.length > 0 ? <MessageAttachments filePaths={evidencePaths} part="documents" /> : null}
                  {replyFiles.length > 0 ? <FilePills files={replyFiles} variant="bubble" /> : null}
                </ChatTextColor.Provider>
              </col>
              {!row.isIntraTurn ? <MessageActions text={text} messageKey={row.id} showReadAloud align="start" timestampMs={row.timestampMs} onReply={reply ?? undefined} /> : null}
            </row>
          ) : null}
          {row.reminder ? <ReminderFireCard mark={row.reminder} text={text} firedAtMs={row.timestampMs} /> : null}
          {hasBody && (inlineImageStrip || hasMedia) ? (
            <col w="full" gap={PART_GAP}>
              {inlineImageStrip}
              {hasMedia ? <MessageAttachments filePaths={evidencePaths} part="media" driveCards={driveCards} expansionKey={row.id} expandedByDefault={latestMedia} /> : null}
            </col>
          ) : null}
          {!hasBody && hasMedia ? (
            <col w="full" gap={PART_GAP}>
              <MessageAttachments filePaths={evidencePaths} part="media" driveCards={driveCards} expansionKey={row.id} expandedByDefault={latestMedia} />
              <MessageAttachments filePaths={evidencePaths} part="documents" />
            </col>
          ) : null}
          {!hasBody && replyFiles.length > 0 ? <FilePills files={replyFiles} /> : null}
          {hasText ? extractStellaAppLinkSlugs(text).map((slug) => <AppPreviewCard key={`app:${slug}`} slug={slug} />) : null}
          {row.agentCompletion?.sections.map((section) => <AgentUpdateCard key={`update:${section.agentId}`} agentId={section.agentId} />)}
          {hasMapArtifacts && row.mapArtifacts ? <MapRouteCards cards={row.mapArtifacts} /> : null}
          {row.officePreviewRef ? <OfficePreviewCard previewRef={row.officePreviewRef} /> : null}
          {hasBody ? null : inlineImageStrip}
          {row.sourceDiffPayloads && row.sourceDiffPayloads.length > 0 ? <SourceDiffEndResource batchId={row.id} payloads={row.sourceDiffPayloads} /> : null}
        </col>
      </col>
    );
  },
  (prev, next) => prev.conversationId === next.conversationId && prev.latestMedia === next.latestMedia && eventRowEqual(prev.row, next.row),
);
