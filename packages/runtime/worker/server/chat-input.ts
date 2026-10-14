import type {
  RuntimeChatPayload,
  RuntimePromptMessage,
} from "@stella/contracts/protocol";
import type { ImageCapTarget } from "../../kernel/shared/image-caps.js";
import {
  approximateDataUrlBytes,
  attachPersistedImagePaths,
  buildSpilledAttachmentNotice,
  dataUrlBase64Length,
  INLINE_IMAGE_ATTACHMENT_BUDGET_BYTES,
  MAX_INLINE_IMAGE_BASE64_BYTES,
  spillImageAttachmentsToDisk,
  type SpilledImageAttachment,
} from "../chat-attachment-spill.js";
import {
  materializeFileAttachments,
  materializeImageAttachments,
} from "./attachments.js";

export const prepareChatInput = async (
  payload: RuntimeChatPayload,
  options: {
    stellaDataDirPath: string;
    resolveImageTarget: () => Promise<ImageCapTarget | undefined>;
  },
) => {
  let composerImageTarget: ImageCapTarget | undefined;
  try {
    composerImageTarget = await options.resolveImageTarget();
  } catch {
    composerImageTarget = undefined;
  }
  const materializedImageAttachments = await materializeImageAttachments(
    payload.attachments,
    composerImageTarget,
  );
  const modelFileAttachments = await materializeFileAttachments({
    attachments: payload.attachments,
    stellaDataDirPath: options.stellaDataDirPath,
    conversationId: payload.conversationId,
  });
  let modelImageAttachments = materializedImageAttachments.map(
    ({ attachment }) => attachment,
  );
  let persistedImageAttachments: SpilledImageAttachment[] = [];
  if (modelImageAttachments.length > 0) {
    persistedImageAttachments = await spillImageAttachmentsToDisk({
      stellaDataDirPath: options.stellaDataDirPath,
      conversationId: payload.conversationId,
      attachments: modelImageAttachments,
    });
    modelImageAttachments = attachPersistedImagePaths(
      modelImageAttachments,
      persistedImageAttachments,
    );
  }
  const totalInlineImageBytes = modelImageAttachments.reduce(
    (total, attachment) => total + approximateDataUrlBytes(attachment.url),
    0,
  );
  let spilledImageAttachments: SpilledImageAttachment[] = [];
  const hasOverCapInlineImage = modelImageAttachments.some(
    (attachment) =>
      dataUrlBase64Length(attachment.url) > MAX_INLINE_IMAGE_BASE64_BYTES,
  );
  if (
    totalInlineImageBytes > INLINE_IMAGE_ATTACHMENT_BUDGET_BYTES ||
    hasOverCapInlineImage
  ) {
    spilledImageAttachments = persistedImageAttachments;
    modelImageAttachments = [];
  }
  const spilledImagePaths = new Map<number, SpilledImageAttachment>();
  for (const [index, spilled] of spilledImageAttachments.entries()) {
    const source = materializedImageAttachments[spilled.attachmentIndex ?? index];
    if (source) spilledImagePaths.set(source.index, spilled);
  }
  const { buildChatPromptMessages } = await import("../../kernel/chat-prompt-context.js");
  const {
    visibleUserPrompt,
    windowContextLabel,
    browserUrl,
    appSelectionLabel,
    appSelectionLabels,
    activityLabel,
    quotedText,
    pastedTexts,
    promptMessages,
    windowScreenshotAttachment,
  } = buildChatPromptMessages({
    userPrompt: payload.userPrompt,
    selectedText:
      payload.selectedText ?? payload.chatContext?.selectedText ?? null,
    chatContext: payload.chatContext ?? null,
    explicitImageAttachmentCount: modelImageAttachments.length,
  });
  const journalDisplayContext = {
    ...(appSelectionLabel ? { appSelectionLabel } : {}),
    ...(appSelectionLabels?.length ? { appSelectionLabels } : {}),
    ...(activityLabel ? { activityLabel } : {}),
    ...(quotedText ? { quotedText } : {}),
    ...(pastedTexts?.length ? { pastedTexts } : {}),
  };
  const userMessageMetadata =
    Object.keys(journalDisplayContext).length > 0
      ? { context: journalDisplayContext }
      : undefined;
  let modelWindowScreenshotAttachment = windowScreenshotAttachment;
  if (modelWindowScreenshotAttachment) {
    const persistedWindowScreenshot = await spillImageAttachmentsToDisk({
      stellaDataDirPath: options.stellaDataDirPath,
      conversationId: payload.conversationId,
      attachments: [modelWindowScreenshotAttachment],
    });
    [modelWindowScreenshotAttachment] = attachPersistedImagePaths(
      [modelWindowScreenshotAttachment],
      persistedWindowScreenshot,
    );
  }
  const runPromptMessages: RuntimePromptMessage[] = [
    ...(promptMessages ?? []),
    ...(spilledImageAttachments.length > 0
      ? [
          {
            text: buildSpilledAttachmentNotice(spilledImageAttachments),
            uiVisibility: "hidden" as const,
            messageType: "message" as const,
            customType: "runtime.chat_context",
          },
        ]
      : []),
  ];
  const mergedAttachments = [
    ...modelImageAttachments,
    ...modelFileAttachments,
    ...(modelWindowScreenshotAttachment
      ? [modelWindowScreenshotAttachment]
      : []),
  ];
  return {
    visibleUserPrompt,
    windowContextLabel,
    browserUrl,
    appSelectionLabel,
    activityLabel,
    journalDisplayContext,
    userMessageMetadata,
    windowScreenshotAttachment,
    modelImageAttachments,
    modelFileAttachments,
    modelWindowScreenshotAttachment,
    spilledImageAttachments,
    spilledImagePaths,
    totalInlineImageBytes,
    runPromptMessages,
    mergedAttachments,
  };
};

export type PreparedChatInput = Awaited<ReturnType<typeof prepareChatInput>>;
