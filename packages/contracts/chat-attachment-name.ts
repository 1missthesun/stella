const CHAT_UPLOAD_PATH =
  /(?:^|\/)(?:Chat Attachments|uploads)\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-([^/]+)$/i;

/**
 * The name to show for a chat attachment. Chat uploads land in Drive as
 * `<folder>/<date>/<8 hex>-<name>` so same-named files never collide; the
 * prefix stays in the path but is not part of the file's name.
 */
export const chatAttachmentDisplayName = (
  path: string,
  name?: string | null,
): string => {
  const original = CHAT_UPLOAD_PATH.exec(path)?.[1];
  const fallback = path.split("/").pop() || path;
  const shown = name?.trim() || fallback;
  if (!original) return shown;
  return shown === fallback || shown === fallback.replace(/^[0-9a-f]{8}-/i, "")
    ? original
    : shown;
};
