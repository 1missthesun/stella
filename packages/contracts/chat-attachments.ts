/**
 * Chat attachments that live in the owner's Drive, shared by the web and
 * desktop renderer, the mobile app and the runtime: where an upload lands,
 * the name shown for it, and the file list a prompt carries.
 */

/** Drive folders chat uploads land in: the web renderer's and the phone's. */
export const CHAT_ATTACHMENT_FOLDERS = {
  web: "Chat Attachments",
  mobile: "uploads",
} as const;

const MAX_FILE_NAME_CHARS = 180;

/** A Drive-safe file name: its last path segment, without control characters. */
export const chatAttachmentFileName = (
  name: string,
  fallback = "attachment",
): string => {
  const cleaned = (name.normalize("NFKC").split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || fallback).slice(-MAX_FILE_NAME_CHARS);
};

/**
 * `<folder>/<YYYY-MM-DD>/<prefix>-<name>`. The prefix keeps same-named files
 * from colliding; `taken` adds a `-2`, `-3`… suffix when a path is reserved.
 */
export const chatAttachmentDrivePath = (args: {
  folder: string;
  name: string;
  now: Date;
  prefix?: string;
  taken?: ReadonlySet<string>;
}): string => {
  const day = args.now.toISOString().slice(0, 10);
  const fileName = `${args.prefix ? `${args.prefix}-` : ""}${chatAttachmentFileName(args.name)}`;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  for (let attempt = 1; ; attempt += 1) {
    const candidate = `${args.folder}/${day}/${
      attempt === 1 ? fileName : `${stem}-${attempt}${extension}`
    }`;
    if (!args.taken?.has(candidate)) return candidate;
  }
};

const CHAT_UPLOAD_PATH = new RegExp(
  `(?:^|/)(?:${Object.values(CHAT_ATTACHMENT_FOLDERS).join("|")})/\\d{4}-\\d{2}-\\d{2}/[0-9a-f]{8}-([^/]+)$`,
  "i",
);

/** The name to show for a chat upload: its own name, without the path's prefix. */
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

/** Appends the Drive file list the agent reads its attachments from. */
export const withAttachmentPreamble = (
  prompt: string,
  paths: readonly string[],
): string => {
  if (!paths.length) return prompt;
  const lines = paths.map((path) => `- ${path}`).join("\n");
  return `${prompt}\n\nAttached in my drive:\n${lines}`;
};

const ATTACHMENT_PREAMBLE = /(?:^|\n\n)Attached in my drive:\n((?:- [^\n]+(?:\n|$))+)$/;
const MAX_LISTED_PATH_CHARS = 400;

/** Splits the file list `withAttachmentPreamble` appended off a prompt. */
export const splitAttachmentPreamble = (
  text: string,
): { text: string; paths: string[] } => {
  const match = ATTACHMENT_PREAMBLE.exec(text);
  if (!match) return { text, paths: [] };
  const paths = match[1]!
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((path) => path.length > 0 && path.length <= MAX_LISTED_PATH_CHARS);
  return { text: text.slice(0, match.index), paths };
};
