import type { ArtifactMediaFile } from "./artifact-media-file";

/**
 * Files the viewer has already loaded this session, so reopening one shows it
 * at once while the viewer rereads it in the background (files change in
 * place; an entry is only a first paint, never the truth). Bounded by entry count and by the
 * bytes of the cache files it owns; evicted entries delete their files.
 */

const MAX_ENTRIES = 16;
const MAX_FILE_BYTES = 192 * 1024 * 1024;
const MAX_TEXT_CHARS = 8 * 1024 * 1024;

type Entry<T> = {
  value: T;
  file: ArtifactMediaFile | null;
  fileBytes: number;
  textChars: number;
  expiresAt: number | null;
  revision: string | null;
};

const entries = new Map<string, Entry<unknown>>();

const totals = () => {
  let fileBytes = 0;
  let textChars = 0;
  for (const entry of entries.values()) {
    fileBytes += entry.fileBytes;
    textChars += entry.textChars;
  }
  return { fileBytes, textChars };
};

const drop = (key: string) => {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  entry.file?.remove();
};

const trim = () => {
  while (entries.size > 0) {
    const { fileBytes, textChars } = totals();
    if (
      entries.size <= MAX_ENTRIES &&
      fileBytes <= MAX_FILE_BYTES &&
      textChars <= MAX_TEXT_CHARS
    ) {
      return;
    }
    const oldest = entries.keys().next().value;
    if (oldest === undefined) return;
    drop(oldest);
  }
};

export function cachedViewerEntry<T>(
  key: string | null,
  stillValid: (value: T) => boolean = () => true,
): { value: T; revision: string | null } | null {
  if (!key) return null;
  const entry = entries.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  if (
    (entry.expiresAt !== null && entry.expiresAt <= Date.now()) ||
    !stillValid(entry.value)
  ) {
    drop(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return { value: entry.value, revision: entry.revision };
}

/**
 * Keep `value` for `key`. Returns whether the cache took ownership of `file`;
 * when it did not, the caller still owns it and removes it as before.
 */
export function storeViewerEntry<T>(
  key: string,
  value: T,
  options: {
    file?: ArtifactMediaFile | null;
    fileBytes?: number;
    textChars?: number;
    expiresAt?: number | null;
    /** What the viewer compares on reread when the value alone can't tell. */
    revision?: string | null;
  } = {},
): boolean {
  const fileBytes = options.file ? Math.max(0, options.fileBytes ?? 0) : 0;
  const textChars = Math.max(0, options.textChars ?? 0);
  if (fileBytes > MAX_FILE_BYTES / 2 || textChars > MAX_TEXT_CHARS / 2) {
    return false;
  }
  drop(key);
  entries.set(key, {
    value,
    file: options.file ?? null,
    fileBytes,
    textChars,
    expiresAt: options.expiresAt ?? null,
    revision: options.revision ?? null,
  });
  trim();
  return entries.has(key);
}
