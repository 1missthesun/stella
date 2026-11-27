// A Stella View a task (a general agent, not Stella herself) made or changed, put into the user's
// chat so it reaches every device. Stella's own views ride in her `view` tool calls; a task's calls
// stay in its own thread, so its `view` tool posts this card into the conversation instead, and
// clients read it exactly like one of Stella's calls (same file path, slug, title and source).
// Every edit posts a newer card; all of one task's cards for a view share one group, so the view
// stays one live card where it first appeared.

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
  /** The task that made it. */
  agentId: string;
  agentTitle?: string;
};

/** The journal group (turn id) of one task's cards for one view. */
export const viewCardTurnId = (agentId: string, slug: string): string => `view:${agentId}:${slug}`;

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
    },
  },
});
