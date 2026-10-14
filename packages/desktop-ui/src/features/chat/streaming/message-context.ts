import type { ChatContext } from "@/shared/types/electron";

export type LocalAttachment = {
  url: string;
  mimeType?: string;
  previewUrl?: string;
  name?: string;
  size?: number;
  kind?: "file";
  path?: string;
};

const buildLocalScreenshotAttachments = (
  chatContext: ChatContext | null | undefined,
): LocalAttachment[] =>
  (chatContext?.regionScreenshots ?? []).map((screenshot) => {
    if (screenshot.filePath) {
      return {
        url: screenshot.filePath,
        previewUrl: screenshot.previewUrl ?? screenshot.dataUrl,
      };
    }
    const match = screenshot.dataUrl.match(
      /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/,
    );
    return {
      url: screenshot.dataUrl,
      mimeType: match ? match[1] : "image/png",
      ...(screenshot.previewUrl ? { previewUrl: screenshot.previewUrl } : {}),
    };
  });
const buildLocalFileAttachments = (
  chatContext: ChatContext | null | undefined,
): LocalAttachment[] =>
  (chatContext?.files ?? []).map((file) => ({
    url: file.dataUrl,
    mimeType: file.mimeType,
    name: file.name,
    size: file.size,
    kind: "file" as const,
    ...(file.path ? { path: file.path } : {}),
  }));
export const buildAllLocalAttachments = (
  chatContext: ChatContext | null | undefined,
): LocalAttachment[] => [
  ...buildLocalScreenshotAttachments(chatContext),
  ...buildLocalFileAttachments(chatContext),
];
export const toDisplayAttachments = (
  attachments: readonly LocalAttachment[],
): Omit<LocalAttachment, "previewUrl">[] =>
  attachments.map(({ previewUrl, ...attachment }) => ({
    ...attachment,
    ...(previewUrl ? { url: previewUrl } : {}),
  }));
