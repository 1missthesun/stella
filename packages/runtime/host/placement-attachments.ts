import type { RuntimeAttachmentRef } from "@stella/contracts/protocol";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";

export type DriveFileResolution = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  url: string;
};

export const placementAttachmentPaths = (
  payload: Record<string, unknown>,
): string[] => {
  if (!Array.isArray(payload.attachments)) return [];
  return payload.attachments.flatMap((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : [],
  );
};

export const resolvePlacementAttachments = async (args: {
  paths: readonly string[];
  resolve: (path: string) => Promise<DriveFileResolution>;
  onSkipped?: (path: string, error: unknown) => void;
}): Promise<RuntimeAttachmentRef[]> => {
  const resolved: RuntimeAttachmentRef[] = [];
  for (const path of args.paths) {
    try {
      const file = await args.resolve(path);
      const contentType = attachmentContentType({ declared: file.contentType, name: file.name || file.path });
      resolved.push({
        url: file.url,
        mimeType: contentType,
        kind: contentType.startsWith("image/") ? "image" : "file",
        name: file.name,
        size: file.sizeBytes,
        drivePath: file.path,
      });
    } catch (error) {
      args.onSkipped?.(path, error);
    }
  }
  return resolved;
};
