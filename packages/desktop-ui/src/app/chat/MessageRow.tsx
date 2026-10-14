import { UserAskRecordCard } from "@/features/user-ask/UserAskRecordCard";
import {
  Fragment,
  memo,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useEntrance } from "@/features/chat/lib/message-entry-animation-state";

import {
  pastedTextPreview,
  type PastedTextDescriptor,
} from "@/features/chat/lib/paste-context";
import { ChipPreviewPortal } from "@/app/chat/ChipPreviewPortal";
import {
  AttachmentTileRow,
  PastedTextTile,
  type AttachmentTileItem,
} from "@/app/chat/AttachmentTiles";
import { useHoverPreview } from "@/app/chat/use-hover-preview";
import type {
  Attachment,
  ChannelEnvelope,
} from "@/features/chat/lib/event-transforms";
import { Markdown } from "@/app/chat/Markdown";
import { SourceDiffEndResource } from "@/app/chat/SourceDiffEndResource";
import { localFilePathForPayload } from "@/features/workspace-display/path-to-viewer";
import { InlineGeneratedImageStrip } from "@/app/chat/InlineGeneratedImageCard";
import { MapRouteCards } from "@/app/chat/MapRouteCard";
import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import { OfficePreviewCard } from "@/app/chat/OfficePreviewCard";
import { FilePills } from "@/app/chat/FilePills";
import type { ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import { MessageAttachments } from "@/app/chat/evidence/MessageAttachments";
import {
  dropAttachmentOnlyLines,
  extractFileLinkTargets,
} from "@stella/contracts/local-file-links";
import { driveLinkPath } from "@stella/contracts/cloud-world-paths";
import { replyAttachmentPlacement } from "@stella/contracts/reply-attachments";
import { presentAssistantText } from "@stella/contracts/assistant-internal-text";
import {
  evidenceCardDrivePath,
  useDriveEvidenceCards,
} from "@/features/chat/hooks/use-drive-evidence-cards";
import { AppPreviewCard } from "@/features/cloud/AppPreviewCard";
import { extractStellaAppLinkSlugs } from "@stella/contracts/workspace-apps";
import { VoiceSessionCard } from "@/app/chat/VoiceSessionCard";
import { ReminderActions } from "@/features/reminders/ReminderActions";
import { ReplyPreview } from "@/app/chat/ReplyPreview";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import { ReplyReportLinks } from "@/app/chat/ReplyReportLinks";
import { AgentUpdateCard } from "@/features/app-source/AppSourceCards";
import { sanitizeAttachmentImageUrl } from "@/shared/lib/url-safety";
import { UserMessageBody } from "@/app/chat/UserMessageBody";
import { MessageActions } from "@/app/chat/MessageActions";
import { useReplyHandoffArrival } from "@/app/chat/reply-handoff";
import { useMessageReply } from "@/app/chat/message-reply-context";
import { truncateChipLabel } from "@/features/chat/composer-context";
import { primaryCopyAttachment } from "@/app/chat/message-copy-attachment";
import {
  ContextPill,
  FileAttachmentChip,
  ImageAttachmentChip,
  fileAttachmentTypeLabelKey,
} from "@/app/chat/ComposerContextChips";
import { useT } from "@/shared/i18n";
import { eventRowEqual } from "@/features/chat/lib/row-equality";
import {
  assistantRowHasVisibleContent,
  shownAgentLabelIds,
} from "@/features/chat/lib/assistant-row-content";
import type {
  AssistantRowViewModel,
  UserRowViewModel,
} from "@/features/chat/conversation-row-types";

type Translate = ReturnType<typeof useT>;

const getAttachmentLabel = (
  attachment: Attachment,
  index: number,
  t: Translate,
) => {
  if (attachment.name) return attachment.name;
  if (attachment.kind) {
    const normalized = attachment.kind.replace(/[_-]+/g, " ").trim();
    if (normalized.length > 0) {
      return normalized[0].toUpperCase() + normalized.slice(1);
    }
  }
  if (attachment.mimeType) return attachment.mimeType;
  return t("app.chat.messageRow.attachmentFallback", { index: index + 1 });
};

const IMAGE_FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|ico|tiff?|heic|heif)$/i;

const isImageAttachment = (attachment: Attachment, safeUrl: string): boolean => {
  if (attachment.kind === "file") return false;
  const mimeType = attachment.mimeType?.trim().toLowerCase();
  if (mimeType) return mimeType.startsWith("image/");
  if (safeUrl.startsWith("data:")) {
    return /^data:image\//i.test(safeUrl);
  }
  // Legacy remote payloads often lack a mimeType; keep the historical
  // image treatment unless the filename clearly says otherwise.
  if (attachment.name && /\.[a-z0-9]+$/i.test(attachment.name)) {
    return IMAGE_FILE_EXT_RE.test(attachment.name);
  }
  return true;
};

const getFileAttachmentName = (
  attachment: Attachment,
  t: Translate,
): string => {
  if (attachment.name) return attachment.name;
  if (attachment.kind && attachment.kind !== "file") {
    const normalized = attachment.kind.replace(/[_-]+/g, " ").trim();
    if (normalized.length > 0) {
      return normalized[0].toUpperCase() + normalized.slice(1);
    }
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
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

const summarizeReactions = (
  envelope: ChannelEnvelope,
  t: Translate,
): string | null => {
  const reactions = envelope.reactions ?? [];
  if (reactions.length === 0) return null;
  const labels = reactions.slice(0, 3).map((reaction) => {
    const prefix = reaction.action === "remove" ? "-" : "+";
    return `${prefix}${reaction.emoji}`;
  });
  const suffix = reactions.length > 3 ? ` +${reactions.length - 3}` : "";
  return t("app.chat.messageRow.reactionsSummary", {
    reactions: `${labels.join(" ")}${suffix}`,
  });
};

function UserWindowContextChip({
  label,
  previewImageUrl,
}: {
  label: string;
  previewImageUrl?: string;
}) {
  const t = useT();
  const { triggerRef, open } = useHoverPreview<HTMLSpanElement>();
  return (
    <span className="event-window-badge-hovercard">
      <ContextPill
        kind="window"
        pillRef={triggerRef}
        label={label}
        data-has-preview={previewImageUrl ? "true" : undefined}
        tabIndex={previewImageUrl ? 0 : undefined}
      />
      {previewImageUrl && (
        <ChipPreviewPortal
          triggerRef={triggerRef}
          open={open}
          preferredPlacement="top"
          className="event-window-preview-card"
        >
          <img
            src={previewImageUrl}
            alt={t("app.chat.messageRow.windowPreviewAlt")}
            className="event-window-preview-img"
          />
        </ChipPreviewPortal>
      )}
    </span>
  );
}

function UserPastedTextChip({
  descriptor,
}: {
  descriptor: PastedTextDescriptor;
}) {
  const t = useT();
  return (
    <PastedTextTile
      text={descriptor.text ?? ""}
      preview={pastedTextPreview(descriptor)}
      label={t("app.chat.messageRow.pastedTextLabel")}
    />
  );
}

function UserQuotedTextChip({ quotedText }: { quotedText: string }) {
  const t = useT();
  const { triggerRef, open, previewProps } = useHoverPreview<HTMLSpanElement>();
  const preview = quotedText.trim();
  const label = truncateChipLabel(preview.replace(/\s+/g, " "), 48);
  return (
    <span className="event-window-badge-hovercard">
      <ContextPill
        kind="selected-text"
        pillRef={triggerRef}
        label={
          preview ? <>&quot;{label}&quot;</> : t("app.chat.messageRow.quotedTextLabel")
        }
        data-has-preview={preview ? "true" : undefined}
        tabIndex={preview ? 0 : undefined}
        aria-label={t("app.chat.messageRow.quotedTextLabel")}
      />
      {preview && (
        <ChipPreviewPortal
          triggerRef={triggerRef}
          open={open}
          preferredPlacement="top"
          className="event-pasted-text-preview-card"
          {...previewProps}
        >
          <div className="event-pasted-text-preview-body">{preview}</div>
        </ChipPreviewPortal>
      )}
    </span>
  );
}


type ContextChip = { key: string; node: ReactNode };

const BUBBLE_MAX_FRACTION = 0.85;
const CHIP_GAP = 6;

function UserContextChips({ chips }: { chips: ContextChip[] }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(chips.length);
  const signature = chips.map((chip) => chip.key).join("|");

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return;
    const column = root.closest(".event-row") as HTMLElement | null;

    const compute = () => {
      const columnWidth = column?.clientWidth ?? root.clientWidth;
      const available = columnWidth * BUBBLE_MAX_FRACTION;
      const items = Array.from(measure.children) as HTMLElement[];
      if (items.length === 0) return;
      const overflowEl = items[items.length - 1];
      const chipEls = items.slice(0, items.length - 1);
      if (chipEls.length <= 1) {
        setVisibleCount(chipEls.length);
        return;
      }

      let total = 0;
      chipEls.forEach((el, index) => {
        total += el.offsetWidth + (index > 0 ? CHIP_GAP : 0);
      });
      if (total <= available) {
        setVisibleCount(chipEls.length);
        return;
      }

      const reserve = overflowEl.offsetWidth + CHIP_GAP;
      let used = 0;
      let count = 0;
      for (let index = 0; index < chipEls.length; index += 1) {
        const width = chipEls[index].offsetWidth + (index > 0 ? CHIP_GAP : 0);
        if (used + width + reserve <= available) {
          used += width;
          count += 1;
        } else {
          break;
        }
      }
      setVisibleCount(Math.max(1, count));
    };

    compute();
    const observer = new ResizeObserver(compute);
    if (column) observer.observe(column);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [signature]);

  const visible = chips.slice(0, visibleCount);
  const hidden = chips.slice(visibleCount);

  return (
    <div className="event-context-chips" ref={rootRef}>
      <div
        className="event-context-chips__measure"
        ref={measureRef}
        aria-hidden
      >
        {chips.map((chip) => (
          <Fragment key={chip.key}>{chip.node}</Fragment>
        ))}
        <span className="event-context-chip event-context-chip--overflow">
          +9
        </span>
      </div>
      {visible.map((chip) => (
        <Fragment key={chip.key}>{chip.node}</Fragment>
      ))}
      {hidden.length > 0 && (
        <>
          <button
            type="button"
            ref={triggerRef}
            className="event-context-chip event-context-chip--overflow"
            aria-label={t("app.chat.messageRow.showMoreChips", {
              count: hidden.length,
            })}
            onMouseEnter={() => setOverflowOpen(true)}
            onMouseLeave={() => setOverflowOpen(false)}
            onFocus={() => setOverflowOpen(true)}
            onBlur={() => setOverflowOpen(false)}
          >
            +{hidden.length}
          </button>
          <ChipPreviewPortal
            triggerRef={triggerRef}
            open={overflowOpen}
            preferredPlacement="top"
            className="event-context-overflow-card"
          >
            {hidden.map((chip) => (
              <Fragment key={chip.key}>{chip.node}</Fragment>
            ))}
          </ChipPreviewPortal>
        </>
      )}
    </div>
  );
}

function AttachmentImage({
  attachment,
  index,
  safeUrl,
}: {
  attachment: Attachment;
  index: number;
  safeUrl: string;
}) {
  const t = useT();
  const label = getAttachmentLabel(attachment, index, t);
  return (
    <ImageAttachmentChip
      thumbnailUrl={safeUrl}
      fullImageUrl={safeUrl}
      alt={attachment.name ?? t("app.chat.messageRow.attachmentAlt")}
      title={t("app.chat.messageRow.clickToEnlarge", { label })}
    />
  );
}

type UserRowProps = {
  row: UserRowViewModel;
};

const MESSAGE_ENTRANCE_MS = 360;
const MESSAGE_ENTRANCE_ANIMATION = "bubble-pop";

const entranceStyle = (delayMs: number | null): CSSProperties | undefined =>
  delayMs === null
    ? undefined
    : ({ "--entrance-delay": `${delayMs}ms` } as CSSProperties);

export const UserMessageRow = memo(
  function UserMessageRow({ row }: UserRowProps) {
    const t = useT();
    const entrance = useEntrance(
      row.arrivedAt,
      MESSAGE_ENTRANCE_MS,
      MESSAGE_ENTRANCE_ANIMATION,
    );
    const reply = useMessageReply();
    const { text, windowLabel, attachments, channelEnvelope } = row;
    const copyAttachment = useMemo(
      () => primaryCopyAttachment(attachments),
      [attachments],
    );
    const appSelectionLabels = (row.appSelectionLabels ?? [])
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
    const activityLabel = row.activityLabel?.trim();
    const pastedTexts = row.pastedTexts ?? [];
    const windowPreviewImageUrl = sanitizeAttachmentImageUrl(
      row.windowPreviewImageUrl,
    );
    const reactionSummary = channelEnvelope
      ? summarizeReactions(channelEnvelope, t)
      : null;

    const chips: ContextChip[] = [];
    const imageTiles: AttachmentTileItem[] = [];
    const fileTiles: AttachmentTileItem[] = [];
    attachments.forEach((attachment, index) => {
      const safeUrl = sanitizeAttachmentImageUrl(attachment.url);
      const key = attachment.id ?? `attachment-${index}`;
      if (safeUrl && isImageAttachment(attachment, safeUrl)) {
        imageTiles.push({
          key,
          node: (
            <AttachmentImage
              attachment={attachment}
              index={index}
              safeUrl={safeUrl}
            />
          ),
        });
        return;
      }
      fileTiles.push({
        key,
        node: (
          <FileAttachmentChip
            name={getFileAttachmentName(attachment, t)}
            size={attachment.size}
            mimeType={attachment.mimeType}
            path={attachment.path}
          />
        ),
      });
    });
    if (windowLabel) {
      chips.push({
        key: "window",
        node: (
          <UserWindowContextChip
            label={windowLabel}
            previewImageUrl={windowPreviewImageUrl ?? undefined}
          />
        ),
      });
    }
    appSelectionLabels.forEach((label, index) => {
      chips.push({
        key: `app-selection-${index}`,
        node: <ContextPill kind="app-selection" label={label} />,
      });
    });
    if (activityLabel) {
      chips.push({
        key: "activity",
        node: <ContextPill kind="activity" label={activityLabel} />,
      });
    }
    if (row.quotedText?.trim()) {
      chips.push({
        key: "quoted-text",
        node: <UserQuotedTextChip quotedText={row.quotedText} />,
      });
    }
    if (channelEnvelope?.provider) {
      chips.push({
        key: "channel-provider",
        node: (
          <span className="event-channel-badge provider">
            {formatProvider(channelEnvelope.provider)}
          </span>
        ),
      });
    }
    if (channelEnvelope && channelEnvelope.kind !== "message") {
      chips.push({
        key: "channel-kind",
        node: (
          <span className="event-channel-badge kind">
            {formatChannelKind(channelEnvelope.kind, t)}
          </span>
        ),
      });
    }
    if (channelEnvelope && reactionSummary) {
      chips.push({
        key: "channel-reaction",
        node: (
          <span className="event-channel-badge reaction">
            {reactionSummary}
          </span>
        ),
      });
    }
    const tiles: AttachmentTileItem[] = [...imageTiles, ...fileTiles];
    pastedTexts.forEach((descriptor, index) => {
      tiles.push({
        key: `pasted-text-${index}`,
        node: <UserPastedTextChip descriptor={descriptor} />,
      });
    });

    return (
      <div
        className={`event-row event-row--user${entrance.delayMs === null ? "" : " event-row--user--just-sent"}`}
        style={entranceStyle(entrance.delayMs)}
        onAnimationEnd={entrance.onAnimationEnd}
        data-chat-row-id={row.id}
      >
        {chips.length > 0 && <UserContextChips chips={chips} />}
        <AttachmentTileRow
          items={tiles}
          align="end"
          className="event-attachment-tiles"
        />
        {/* Bubble + its hover controls share one horizontal line: Reply and
            Copy sit to the LEFT of the right-aligned bubble and costs no vertical
            space. It mounts for any user message that has visible content —
            text OR attachment/context chips — so attachment-only messages keep
            the same actions. Copy falls back to the attachment when there is
            no text to copy. */}
        {(text.trim() || chips.length > 0 || tiles.length > 0) && (
          <div className="message-line message-line--user">
            <MessageActions
              text={text}
              messageKey={row.id}
              align="end"
              timestampMs={row.timestampMs}
              copyAttachment={copyAttachment ?? undefined}
              onReply={reply ?? undefined}
            />
            {text.trim() ? (
              <div
                className={`event-item user chat-bubble-text${row.reaction ? " event-item--reacted" : ""}`}
              >
                {row.reaction ? (
                  <span
                    key={row.reaction}
                    className={`event-item__reaction${row.reactionAt && Date.now() - row.reactionAt < 10_000 ? " event-item__reaction--fresh" : ""}`}
                    role="img"
                    aria-label={t("app.chat.messageRow.stellaReaction", {
                      emoji: row.reaction,
                    })}
                    title={t("app.chat.messageRow.stellaReaction", {
                      emoji: row.reaction,
                    })}
                  >
                    {row.reaction}
                  </span>
                ) : null}
                <UserMessageBody text={text} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  },
  (prev, next) => eventRowEqual(prev.row, next.row),
);

type AssistantRowProps = {
  row: AssistantRowViewModel;
  conversationId?: string | null;
};

export const AssistantMessageRow = memo(
  function AssistantMessageRow({
    row,
    conversationId,
  }: AssistantRowProps) {
    const reply = useMessageReply();
    const rowRef = useRef<HTMLDivElement>(null);
    const entrance = useEntrance(
      row.arrivedAt,
      MESSAGE_ENTRANCE_MS,
      MESSAGE_ENTRANCE_ANIMATION,
    );
    useReplyHandoffArrival(rowRef, entrance.delayMs !== null, !row.isIntraTurn);
    const text = row.text;
    const hasText = text.trim().length > 0;
    const hasMapArtifacts = (row.mapArtifacts?.length ?? 0) > 0;
    const hasVoiceSession = Boolean(row.voiceSession);
    const labelIds = shownAgentLabelIds(row);
    const pillCompletions = [
      ...new Map(
        (row.agentCompletion?.sections ?? [])
          .filter((section) => labelIds.includes(section.agentId))
          .map((section) => [section.agentId, section] as const),
      ).values(),
    ];
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
              row.replyRefs?.find(
                (ref): ref is Extract<ReplyRef, { kind: "agent" }> =>
                  ref.kind === "agent" && ref.threadId === threadId,
              )?.title ??
              "",
          }),
        ),
    ];
    const hasAgentCompletion = Boolean(
      row.agentCompletion && row.agentCompletion.sections.length > 0,
    );
    const linkedFiles = row.linkedFiles ?? [];
    const linkTargets = hasText ? extractFileLinkTargets(text) : [];
    const evidencePaths = linkTargets.filter((target) => !driveLinkPath(target));
    const evidencePathSet = new Set(evidencePaths);
    const linkedDrivePaths = [
      ...new Set(
        linkTargets.flatMap((target) => {
          const drivePath = driveLinkPath(target);
          return drivePath ? [drivePath] : [];
        }),
      ),
    ];
    const driveCards = useDriveEvidenceCards(
      linkedDrivePaths.filter(
        (drivePath) => replyAttachmentPlacement(drivePath) === "media",
      ),
    );
    const previewedDrivePaths = new Set(
      driveCards.flatMap((card) => {
        const drivePath = evidenceCardDrivePath(card);
        return drivePath ? [drivePath] : [];
      }),
    );
    const hasMedia = evidencePaths.length > 0 || driveCards.length > 0;
    const unpreviewableFiles = linkedFiles.filter(
      (file) => file.cloudDriveFile || !evidencePathSet.has(file.path),
    );
    const resourcePayload = row.resourcePayload;
    const resourceShownElsewhere =
      !resourcePayload ||
      resourcePayload.kind === "source-diff" ||
      (resourcePayload.kind === "media" &&
        resourcePayload.presentation === "inline-image") ||
      (resourcePayload.kind === "office" && Boolean(row.officePreviewRef));
    const resourceFilePath =
      resourcePayload && !resourceShownElsewhere
        ? localFilePathForPayload(resourcePayload)
        : null;
    const attachedFiles =
      resourcePayload && resourceFilePath
        ? [
            ...unpreviewableFiles,
            {
              path: resourceFilePath,
              timestamp:
                ("createdAt" in resourcePayload
                  ? resourcePayload.createdAt
                  : undefined) ??
                row.timestampMs ??
                0,
              payload: resourcePayload,
            },
          ]
        : unpreviewableFiles;
    const fileKey = (file: ConversationFileEntry) =>
      file.cloudDriveFile ? `cloud:${file.cloudDriveFile.path}` : `local:${file.path}`;
    const replyFiles = attachedFiles.filter(
      (file, index, all) =>
        (file.cloudDriveFile
          ? !previewedDrivePaths.has(file.cloudDriveFile.path)
          : !evidencePathSet.has(file.path)) &&
        all.findIndex((other) => fileKey(other) === fileKey(file)) === index,
    );
    const hiddenFileKeys = linkedFiles
      .map(fileKey)
      .concat(evidencePaths.map((filePath) => `local:${filePath}`))
      .concat(linkedDrivePaths.map((drivePath) => `cloud:${drivePath}`));
    const hiddenFileKeySet = new Set(hiddenFileKeys);
    const bodyText = hasText
      ? dropAttachmentOnlyLines(presentAssistantText(text), (filePath) => {
          const drivePath = driveLinkPath(filePath);
          return (
            hiddenFileKeySet.has(`local:${filePath}`) ||
            (drivePath !== null && hiddenFileKeySet.has(`cloud:${drivePath}`))
          );
        })
      : text;
    const hasBody = bodyText.trim().length > 0;
    const inlineImages = (row.inlineImagePayloads ?? []).filter(
      (payload): payload is Extract<DisplayPayload, { kind: "media" }> =>
        payload.kind === "media" &&
        payload.presentation === "inline-image" &&
        payload.asset.kind === "image",
    );
    const inlineImageStrip =
      inlineImages.length > 0 ? (
        <InlineGeneratedImageStrip
          conversationId={conversationId}
          payloads={inlineImages}
        />
      ) : null;
    if (!assistantRowHasVisibleContent(row)) {
      return null;
    }

    return (
      <div
        ref={rowRef}
        className={`event-row event-row--assistant${entrance.delayMs === null ? "" : " event-row--assistant--just-arrived"}`}
        style={entranceStyle(entrance.delayMs)}
        onAnimationEnd={entrance.onAnimationEnd}
        data-chat-row-id={row.id}
        data-scroll-follow-key={row.id}
        data-react-key={row.id}
      >
        <div className="event-item assistant">
          {hasVoiceSession && row.voiceSession && (
            <VoiceSessionCard durationMs={row.voiceSession.durationMs} />
          )}
          {conversationId && (pillRefs.length > 0 || pillCompletions.length > 0) ? (
            <ReplyPreview
              refs={pillRefs}
              completions={pillCompletions}
              conversationId={conversationId}
            />
          ) : null}
          {row.askRecords?.map((record) => (
            <UserAskRecordCard key={record.id} record={record} />
          ))}
          {hasBody && (
            <div className="message-line message-line--assistant">
              <div className="assistant-message-text chat-bubble-text">
                <Markdown text={bodyText} cacheKey={row.cacheKey} hideHorizontalRules
                  hiddenFilePaths={hiddenFileKeys}
                />
                {conversationId &&
                ((row.replyRefs && row.replyRefs.length > 0) || hasAgentCompletion) ? (
                  <ReplyReportLinks
                    refs={row.replyRefs ?? []}
                    completions={row.agentCompletion?.sections}
                    conversationId={conversationId}
                  />
                ) : null}
                {evidencePaths.length > 0 ? (
                  <MessageAttachments filePaths={evidencePaths} part="documents" />
                ) : null}
                {replyFiles.length > 0 ? (
                  <FilePills files={replyFiles} variant="bubble" />
                ) : null}
              </div>
              {!row.isIntraTurn && (
                <MessageActions
                  text={text}
                  messageKey={row.id}
                  showReadAloud
                  align="start"
                  timestampMs={row.timestampMs}
                  onReply={reply ?? undefined}
                />
              )}
            </div>
          )}
          {row.reminder ? <ReminderActions mark={row.reminder} /> : null}
          {hasBody && (inlineImageStrip || hasMedia) ? (
            <div className="assistant-media">
              {inlineImageStrip}
              {hasMedia ? (
                <MessageAttachments
                  filePaths={evidencePaths}
                  part="media"
                  driveCards={driveCards}
                />
              ) : null}
            </div>
          ) : null}
          {!hasBody && hasMedia ? (
            <div className="assistant-media">
              <MessageAttachments
                filePaths={evidencePaths}
                part="media"
                driveCards={driveCards}
              />
              <MessageAttachments filePaths={evidencePaths} part="documents" />
            </div>
          ) : null}
          {!hasBody && replyFiles.length > 0 ? (
            <FilePills files={replyFiles} />
          ) : null}
          {hasText
            ? extractStellaAppLinkSlugs(text).map((slug) => (
                <AppPreviewCard key={`app:${slug}`} slug={slug} />
              ))
            : null}
          {row.agentCompletion?.sections.map((section) => (
            <AgentUpdateCard key={`update:${section.agentId}`} agentId={section.agentId} />
          ))}
          {hasMapArtifacts && row.mapArtifacts && (
            <MapRouteCards cards={row.mapArtifacts} />
          )}
          {row.officePreviewRef && (
            <OfficePreviewCard previewRef={row.officePreviewRef} />
          )}
          {hasBody ? null : inlineImageStrip}
          {row.sourceDiffPayloads && row.sourceDiffPayloads.length > 0 ? (
            <SourceDiffEndResource
              batchId={row.id}
              payloads={row.sourceDiffPayloads}
            />
          ) : null}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.conversationId === next.conversationId &&
    eventRowEqual(prev.row, next.row),
);
