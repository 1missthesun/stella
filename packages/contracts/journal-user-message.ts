import { splitAttachmentPreamble } from "./chat-attachments.js";
import { messageText } from "./conversation-protocol.js";

export type JournalPastedText = { lines: number; chars: number; text?: string };

/** What the composer showed beside the prompt (paste chips, quotes, selections). */
export type JournalUserDisplayContext = {
  pastedTexts?: JournalPastedText[];
  appSelectionLabels?: string[];
  appSelectionLabel?: string;
  activityLabel?: string;
  quotedText?: string;
};

export type JournalDeclaredFile = {
  name?: string;
  path?: string;
  mimeType?: string;
  size?: number;
};

/** A user journal message as every chat surface shows it. */
export type JournalUserMessage = {
  /** The user's words: the display text when one was stored, else the prompt without its Drive file list. */
  text: string;
  /** The display text the sender stored, when it differs from the prompt. */
  displayText?: string;
  /** Drive files sent with the message, from the turn's attachments and the prompt's file list. */
  drivePaths: string[];
  /** Images sent inline as base64. */
  inlineImages: { data: string; mimeType: string }[];
  /** Local files the sender declared (desktop turns). */
  declaredFiles: JournalDeclaredFile[];
  displayContext?: JournalUserDisplayContext;
  /** Nothing to show: no words, files, images, context or other content. */
  blank: boolean;
};

const MAX_PATH_CHARS = 400;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const blocksOf = (payload: Record<string, unknown>): Record<string, unknown>[] =>
  Array.isArray(payload.content)
    ? payload.content.flatMap((entry) => {
        const block = asRecord(entry);
        return block ? [block] : [];
      })
    : [];

const turnAttachmentPaths = (payload: Record<string, unknown>): string[] => {
  const raw = asRecord(payload.providerContext)?.attachments;
  return Array.isArray(raw)
    ? raw.filter(
        (path): path is string =>
          typeof path === "string" && path.length > 0 && path.length <= MAX_PATH_CHARS,
      )
    : [];
};

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const displayContextOf = (
  payload: Record<string, unknown>,
): JournalUserDisplayContext | undefined => {
  const context = asRecord(asRecord(payload.metadata)?.context);
  if (!context) return undefined;
  const pastedTexts = (Array.isArray(context.pastedTexts) ? context.pastedTexts : [])
    .flatMap((entry): JournalPastedText[] => {
      const descriptor = asRecord(entry);
      return descriptor &&
        typeof descriptor.lines === "number" &&
        typeof descriptor.chars === "number"
        ? [{
            lines: descriptor.lines,
            chars: descriptor.chars,
            ...(typeof descriptor.text === "string" ? { text: descriptor.text } : {}),
          }]
        : [];
    });
  const appSelectionLabels = Array.isArray(context.appSelectionLabels)
    ? context.appSelectionLabels.filter((label): label is string => Boolean(nonEmpty(label)))
    : [];
  const appSelectionLabel = nonEmpty(context.appSelectionLabel);
  const activityLabel = nonEmpty(context.activityLabel);
  const quotedText = nonEmpty(context.quotedText);
  const result: JournalUserDisplayContext = {
    ...(pastedTexts.length ? { pastedTexts } : {}),
    ...(appSelectionLabels.length ? { appSelectionLabels } : {}),
    ...(appSelectionLabel ? { appSelectionLabel } : {}),
    ...(activityLabel ? { activityLabel } : {}),
    ...(quotedText ? { quotedText } : {}),
  };
  return Object.keys(result).length ? result : undefined;
};

const declaredFilesOf = (payload: Record<string, unknown>): JournalDeclaredFile[] =>
  (Array.isArray(payload.attachments) ? payload.attachments : []).flatMap(
    (entry): JournalDeclaredFile[] => {
      const record = asRecord(entry);
      if (record?.kind !== "file") return [];
      const path =
        typeof record.path === "string"
          ? record.path
          : typeof record.sourcePath === "string"
            ? record.sourcePath
            : undefined;
      return [{
        ...(typeof record.name === "string" ? { name: record.name } : {}),
        ...(path ? { path } : {}),
        ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
        ...(typeof record.size === "number" ? { size: record.size } : {}),
      }];
    },
  );

export const journalUserMessage = (
  payload: Record<string, unknown>,
): JournalUserMessage => {
  const prompt = splitAttachmentPreamble(messageText(payload));
  const storedDisplayText = asRecord(payload.metadata)?.displayText;
  const displayText = typeof storedDisplayText === "string" ? storedDisplayText : undefined;
  const text = displayText ?? prompt.text;
  const drivePaths = [...new Set([...turnAttachmentPaths(payload), ...prompt.paths])];
  const blocks = blocksOf(payload);
  const inlineImages = blocks.flatMap((block) =>
    block.type === "image" &&
    typeof block.data === "string" &&
    block.data.length > 0 &&
    typeof block.mimeType === "string"
      ? [{ data: block.data, mimeType: block.mimeType }]
      : [],
  );
  const declaredFiles = declaredFilesOf(payload);
  const displayContext = displayContextOf(payload);
  return {
    text,
    ...(displayText !== undefined ? { displayText } : {}),
    drivePaths,
    inlineImages,
    declaredFiles,
    ...(displayContext ? { displayContext } : {}),
    blank:
      !text.trim() &&
      drivePaths.length === 0 &&
      declaredFiles.length === 0 &&
      !displayContext &&
      !blocks.some((block) => block.type !== "text"),
  };
};
