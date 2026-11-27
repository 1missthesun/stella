// Every Stella View the account has, for the Apps list on each device: one row per view, named
// `<conversationId>/<slug>` like its synced storage, holding its newest version (title, source,
// data) whichever way that version landed: the orchestrator's `view` tool on a computer
// (`viewIndex.record` through the user's session) or in the cloud, a task's view card
// (`conversations.publishView`), or a restore that goes through either. Devices watch
// `viewIndex.list` for the list and `viewIndex.get` for one view's source, so a view opened from
// Apps swaps to a newer version the moment it lands, as it does in the chat.

export const VIEW_INDEX_LIMITS = {
  maxSourceBytes: 256 * 1024,
  /** Bigger data isn't kept in the index; the view opens from Apps without it. */
  maxDataBytes: 256 * 1024,
  maxTitleChars: 200,
  maxFilePathChars: 1024,
  /** The list shows the newest this many. */
  maxListed: 500,
} as const;

/** `<conversationId>/<slug>`, as view storage names a view. */
export const VIEW_INDEX_ID_PATTERN = /^[\w.:-]{1,160}\/[\w.-]{1,128}$/u;

export const viewIndexId = (conversationId: string, slug: string): string => `${conversationId}/${slug}`;

export const isViewIndexId = (value: unknown): value is string =>
  typeof value === "string" && VIEW_INDEX_ID_PATTERN.test(value);

/** A view in the Apps list. */
export type IndexedView = {
  id: string;
  conversationId: string;
  slug: string;
  /** Where its newest version was written (a computer's path, or a Drive path); its key on every device. */
  filePath: string;
  title: string;
  /** A Lucide icon name the view itself uses first, for its tile; null when it uses none. */
  icon: string | null;
  /** How many versions have landed. */
  version: number;
  /** When its first version landed. */
  createdAt: number;
  /** When its newest version was written. */
  updatedAt: number;
  /** The chat it lives in, when the account still has it. */
  conversationTitle: string | null;
};

/** One view with the source and data its newest version runs. */
export type IndexedViewSource = IndexedView & {
  source: string;
  /** The newest data any version gave, when it fits the index; absent when none did. */
  data?: unknown;
};

export type ViewIndexRecordArgs = {
  conversationId: string;
  filePath: string;
  slug: string;
  title: string;
  source: string;
  data?: unknown;
  createdAt: number;
};

export type ViewIndexCalls = {
  /** A version the orchestrator's `view` tool wrote on a computer. */
  "viewIndex.record": { args: ViewIndexRecordArgs; result: { recorded: boolean; version: number } };
  /** Takes a view off the Apps list (its next version brings it back). */
  "viewIndex.remove": { args: { id: string }; result: { removed: true } };
};

export type ViewIndexViews = {
  "viewIndex.list": { args: Record<string, never>; result: IndexedView[] };
  "viewIndex.get": { args: { id: string }; result: IndexedViewSource | null };
};

const ICON_RE = /<Icon\b[^>]*?\bname\s*=\s*["']([a-z0-9-]{1,64})["']|\bicon\s*[=:]\s*["']([a-z0-9-]{1,64})["']/u;

/** The first Lucide icon a view's source names (`<Icon name="…">`, `icon="…"`), for its tile. */
export const viewSourceIcon = (source: string): string | null => {
  const match = ICON_RE.exec(source);
  return match?.[1] ?? match?.[2] ?? null;
};
