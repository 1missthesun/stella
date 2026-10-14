export const isWebShell = (): boolean =>
  typeof window !== "undefined" &&
  !(window as { electronAPI?: unknown }).electronAPI;

export type CloudAttachment = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType?: string;
};

let attachments: readonly CloudAttachment[] = [];
const attachmentListeners = new Set<() => void>();

const emitAttachments = (next: readonly CloudAttachment[]): void => {
  attachments = next;
  for (const listener of attachmentListeners) listener();
};

export const cloudAttachmentsStore = {
  subscribe(listener: () => void): () => void {
    attachmentListeners.add(listener);
    return () => attachmentListeners.delete(listener);
  },
  getSnapshot(): readonly CloudAttachment[] {
    return attachments;
  },
  add(attachment: CloudAttachment): void {
    emitAttachments([
      ...attachments.filter((entry) => entry.path !== attachment.path),
      attachment,
    ]);
  },
  remove(path: string): void {
    emitAttachments(attachments.filter((entry) => entry.path !== path));
  },
  clear(): void {
    if (attachments.length) emitAttachments([]);
  },
  clearIfCurrent(expected: readonly CloudAttachment[]): boolean {
    if (
      attachments.length !== expected.length ||
      attachments.some((attachment, index) => {
        const submitted = expected[index];
        return (
          !submitted ||
          attachment.path !== submitted.path ||
          attachment.name !== submitted.name ||
          attachment.sizeBytes !== submitted.sizeBytes ||
          attachment.contentType !== submitted.contentType
        );
      })
    ) return false;
    if (attachments.length) emitAttachments([]);
    return true;
  },
};

export const withAttachmentPreamble = (
  prompt: string,
  files: readonly CloudAttachment[],
): string => {
  if (!files.length) return prompt;
  const lines = files.map((file) => `- ${file.path}`).join("\n");
  return `${prompt}\n\nAttached in my drive:\n${lines}`;
};
