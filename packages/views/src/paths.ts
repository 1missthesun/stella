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
