// Contract between desktop main, which saves an agent's in-app browser
// downloads under <stella data>/media/downloads/<owner>/ and appends one line
// per finished download to the index there, and the runtime, which reads it.

export const IN_APP_BROWSER_DOWNLOADS_INDEX = ".downloads.jsonl";

export const inAppBrowserDownloadsOwnerSegment = (ownerId: string): string => {
  const cleaned = ownerId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "shared";
};

export const inAppBrowserDownloadsSegments = (ownerId: string) =>
  ["media", "downloads", inAppBrowserDownloadsOwnerSegment(ownerId)] as const;

export type InAppBrowserDownloadState = "completed" | "cancelled" | "interrupted";

export type InAppBrowserDownloadRecord = Readonly<{
  id: string;
  path: string;
  filename: string;
  url: string;
  mimeType: string;
  state: InAppBrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  finishedAt: number;
}>;

const DOWNLOAD_STATES = new Set<string>(["completed", "cancelled", "interrupted"]);

export const parseInAppBrowserDownloadRecord = (
  line: string,
): InAppBrowserDownloadRecord | null => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  const count = (key: string) =>
    typeof record[key] === "number" && Number.isFinite(record[key])
      ? (record[key] as number)
      : 0;
  const state = text("state");
  if (!text("id") || !text("path") || !DOWNLOAD_STATES.has(state)) return null;
  return {
    id: text("id"),
    path: text("path"),
    filename: text("filename"),
    url: text("url"),
    mimeType: text("mimeType"),
    state: state as InAppBrowserDownloadState,
    receivedBytes: count("receivedBytes"),
    totalBytes: count("totalBytes"),
    startedAt: count("startedAt"),
    finishedAt: count("finishedAt"),
  };
};
