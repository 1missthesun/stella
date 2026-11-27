export const CHAT_ATTACHMENT_FOLDERS = {
  web: "Chat Attachments",
  mobile: "uploads",
} as const;

const MAX_FILE_NAME_CHARS = 180;

/**
 * Files sent with a chat message live in these reserved folders: the web
 * and desktop composers' Chat Attachments (including messages relayed to
 * where Stella runs), the phone's dated uploads, and attachments carried to
 * another device with a placed chat. The server keeps them apart from the
 * Drive, so they never count against or wait on the Drive quota.
 */
const CHAT_ATTACHMENT_PATH = new RegExp(
  `^(?:${CHAT_ATTACHMENT_FOLDERS.web}/|execution-attachments/|${CHAT_ATTACHMENT_FOLDERS.mobile}/\\d{4}-\\d{2}-\\d{2}/[0-9a-f]{8}-[^/]+$)`,
);

export const isChatAttachmentPath = (path: string): boolean => CHAT_ATTACHMENT_PATH.test(path);

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
