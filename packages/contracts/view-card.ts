// A Stella View a task (a general agent, not Stella herself) made or changed, put into the user's
// chat so it reaches every device. Stella's own views ride in her `view` tool calls; a task's calls
// stay in its own thread, so its `view` tool posts this card into the conversation instead, and
// clients read it exactly like one of Stella's calls (same file path, slug, title and source).
// Every edit posts a newer card; all of one task's cards for a view share one group, so the view
// stays one live card where it first appeared.
// The user restoring an earlier version posts a card too (`restoredFrom`, by `VIEW_RESTORE_AUTHOR`),
// so a restore is a new latest version: history is never rewritten, and the restore can be undone.
// Each restore is its own group, so it shows where it happened.

export const VIEW_CARD_TYPE = "view";

/** The source travels in the card; views are small, and this keeps a card far below a journal row. */
export const VIEW_CARD_MAX_SOURCE_BYTES = 256 * 1024;
export const VIEW_CARD_MAX_DATA_BYTES = 256 * 1024;

export type ViewCard = {
  type: typeof VIEW_CARD_TYPE;
  /** Where the task wrote it (on its computer, or in the cloud workspace); the view's key on every device. */
  filePath: string;
  slug: string;
  title: string;
  source: string;
  /** The newest data the task gave with this version, when it gave any. */
  data?: unknown;
  createdAt: number;
  /** The task that made it; `VIEW_RESTORE_AUTHOR` for the user's restore. */
  agentId: string;
  agentTitle?: string;
  /** A restore: the `createdAt` of the earlier version it brings back. */
  restoredFrom?: number;
};

/** The author of a restore card: the user, bringing back an earlier version. */
export const VIEW_RESTORE_AUTHOR = "user";

/** The journal group (turn id) of one task's cards for one view. */
export const viewCardTurnId = (agentId: string, slug: string): string => `view:${agentId}:${slug}`;

/** The journal group of a card: its task's group, or a restore's own. */
export const viewCardGroup = (card: Pick<ViewCard, "agentId" | "slug" | "createdAt" | "restoredFrom">): string =>
  card.restoredFrom !== undefined ? `view:${VIEW_RESTORE_AUTHOR}:${card.slug}:${card.createdAt}` : viewCardTurnId(card.agentId, card.slug);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() && value.length <= max ? value : null;

export const parseViewCard = (raw: unknown): ViewCard | null => {
  if (!isRecord(raw) || raw.type !== VIEW_CARD_TYPE) return null;
  const filePath = text(raw.filePath, 1024);
  const slug = text(raw.slug, 128);
  const title = text(raw.title, 200);
  const source = text(raw.source, VIEW_CARD_MAX_SOURCE_BYTES);
  const agentId = text(raw.agentId, 128);
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : null;
  if (!filePath || !slug || !title || !source || !agentId || createdAt === null) return null;
  if (!/\.view\.(tsx|ts|jsx|js)$/iu.test(filePath)) return null;
  const agentTitle = text(raw.agentTitle, 200);
  const restoredFrom = typeof raw.restoredFrom === "number" && Number.isFinite(raw.restoredFrom) ? raw.restoredFrom : undefined;
  if (restoredFrom !== undefined && agentId !== VIEW_RESTORE_AUTHOR) return null;
  return {
    type: VIEW_CARD_TYPE,
    filePath,
    slug,
    title,
    source,
    ...("data" in raw && raw.data !== undefined ? { data: raw.data } : {}),
    createdAt,
    agentId,
    ...(agentTitle ? { agentTitle } : {}),
    ...(restoredFrom !== undefined ? { restoredFrom } : {}),
  };
};

/**
 * The card as the `view` tool call and result a client already reads for Stella's own views:
 * the call's arguments carry the source and data, the result names the file.
 */
export const viewCardToolEvents = (
  card: ViewCard,
): {
  call: { toolName: "view"; args: Record<string, unknown> };
  result: { toolName: "view"; agentType: "orchestrator"; details: Record<string, unknown> };
} => ({
  call: {
    toolName: "view",
    args: {
      slug: card.slug,
      title: card.title,
      source: card.source,
      ...(card.data !== undefined ? { data: card.data } : {}),
    },
  },
  result: {
    toolName: "view",
    // Clients show a reply's view only from Stella's own calls; the task's card speaks for her.
    agentType: "orchestrator",
    details: {
      filePath: card.filePath,
      slug: card.slug,
      title: card.title,
      createdAt: card.createdAt,
      agentId: card.agentId,
      ...(card.agentTitle ? { agentTitle: card.agentTitle } : {}),
      ...(card.restoredFrom !== undefined ? { restoredFrom: card.restoredFrom } : {}),
    },
  },
});

const clock = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

/**
 * A restore as the orchestrator reads it in the conversation (desktop and cloud import it like a
 * reminder): its own `view` calls hold the version it last wrote, so it learns which source is
 * current now. The chat shows the card itself, not this message.
 */
export const viewRestoreAssistantMessage = (card: ViewCard, createdAtMs: number) => ({
  role: "assistant" as const,
  content: [
    {
      type: "text" as const,
      text:
        `[The user restored the view "${card.title}" (slug "${card.slug}", ${card.filePath}) to its version from ${clock(card.restoredFrom ?? card.createdAt)}, ` +
        `so this is its current source, newer than any earlier view call for it:]\n\n\`\`\`tsx\n${card.source}\n\`\`\``,
    },
  ],
  api: "stella-view-restore",
  provider: "stella",
  model: "view-restore",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: createdAtMs,
  viewRestore: { slug: card.slug, filePath: card.filePath, createdAt: card.createdAt, restoredFrom: card.restoredFrom ?? card.createdAt },
});
