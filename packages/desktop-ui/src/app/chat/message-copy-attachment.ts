import type { Attachment } from "@stella/contracts/local-chat";

const isImageCopyAttachment = (attachment: Attachment) => {
  const mimeType = attachment.mimeType ?? "";
  if (attachment.kind === "file" && !mimeType.startsWith("image/"))
    return false;
  if (mimeType.startsWith("image/")) return true;
  if (
    typeof attachment.url === "string" &&
    attachment.url.startsWith("data:image/")
  )
    return true;
  return attachment.kind !== "file" && !mimeType;
};

export const primaryCopyAttachment = (
  attachments: ReadonlyArray<Attachment> | undefined,
) => {
  const usable = (attachments ?? []).filter(
    (attachment) =>
      attachment &&
      ((typeof attachment.url === "string" && attachment.url.length > 0) ||
        (typeof attachment.path === "string" && attachment.path.length > 0)),
  );
  if (usable.length === 0) return null;
  const chosen = usable.find(isImageCopyAttachment) ?? usable[0];
  return {
    ...(chosen.path ? { path: chosen.path } : {}),
    ...(chosen.url ? { url: chosen.url } : {}),
    ...(chosen.mimeType ? { mimeType: chosen.mimeType } : {}),
    ...(chosen.kind ? { kind: chosen.kind } : {}),
    ...(chosen.name ? { name: chosen.name } : {}),
  };
};
