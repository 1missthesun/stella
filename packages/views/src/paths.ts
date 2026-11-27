// A view's names and keys, from its path: pure, so every platform (Node, a browser, Hermes) shares
// them and a view keeps the same key, and so the same storage, wherever it runs.

export const VIEW_FILE_RE = /\.view\.(tsx|ts|jsx|js)$/iu;

export const isViewPath = (filePath: string): boolean => VIEW_FILE_RE.test(filePath);

/** A short stable id for a view's path (FNV-1a), naming its storage and status. */
export const viewKey = (filePath: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < filePath.length; i++) h = Math.imul(h ^ filePath.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

/** A content hash of a view's source, so a status names the source it came from. */
export const viewSourceHash = (source: string): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
};

/** The view's data file: `name.view.tsx` → `name.data.json` beside it. */
export const viewDataPath = (filePath: string): string => filePath.replace(VIEW_FILE_RE, ".data.json");

/** The file's name, for a path from any platform. */
export const viewFileName = (filePath: string): string => filePath.split(/[\\/]/u).pop() ?? filePath;

export const viewTitle = (filePath: string): string =>
  viewFileName(filePath)
    .replace(VIEW_FILE_RE, "")
    .replace(/[-_]+/gu, " ")
    .replace(/^\w/u, (c) => c.toUpperCase());

// ------------------------------------------------------------------ where a conversation's views live
//
// Each conversation keeps its views in a folder of its own, `outputs/views/<conversation>/<slug>.view.tsx`,
// so the same slug in two chats is two views (two files, two storages), and a view's file names the
// view it is: `<conversationId>/<slug>`, its synced id, comes straight from its path. Views written
// before this (`outputs/views/<slug>.view.tsx`) keep their path and learn their id from the chat.

/** The folder a conversation's views live in, under `outputs/views`: the id, with anything a file name can't hold escaped as `~XX`. */
export const viewConversationDirName = (conversationId: string): string => {
  let out = "";
  for (const ch of conversationId) {
    if (/[A-Za-z0-9_-]/u.test(ch) || (ch === "." && out.length > 0)) out += ch;
    else {
      const encoded = encodeURIComponent(ch);
      out += encoded.startsWith("%") ? encoded.replace(/%/gu, "~") : `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
};

/** The conversation id a folder from `viewConversationDirName` names, or null when it isn't one. */
export const conversationIdFromViewDirName = (name: string): string | null => {
  if (!name || !/^(?:[A-Za-z0-9_-]|~[0-9A-F]{2})(?:[A-Za-z0-9_.-]|~[0-9A-F]{2})*$/u.test(name)) return null;
  try {
    return decodeURIComponent(name.replace(/~/gu, "%"));
  } catch {
    return null;
  }
};

/** `outputs/views/<conversation>/<slug>.view.tsx`, relative to wherever outputs are (a data dir, the Drive). */
export const conversationViewRelPath = (conversationId: string, slug: string): string => `outputs/views/${viewConversationDirName(conversationId)}/${slug}.view.tsx`;

const CONVERSATION_VIEW_RE = /(?:^|[\\/])outputs[\\/]views[\\/]([^\\/]+)[\\/]([\w.-]{1,128})\.view\.(?:tsx|ts|jsx|js)$/iu;

/** The conversation and slug a view's path names (`…/outputs/views/<conversation>/<slug>.view.tsx`), or null for any other path. */
export const viewIdentityFromPath = (filePath: string): { conversationId: string; slug: string } | null => {
  const match = CONVERSATION_VIEW_RE.exec(filePath);
  if (!match) return null;
  const conversationId = conversationIdFromViewDirName(match[1]!);
  return conversationId ? { conversationId, slug: match[2]! } : null;
};
