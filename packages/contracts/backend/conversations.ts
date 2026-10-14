export type ConversationSummary = {
  ownerId: string;
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastPreview?: string;
  lastRole?: string;
  activity?: "idle" | "running";
};

export type OwnerIdentity = {
  ownerId: string;
  ownerGeneration: string;
  isAnonymous: boolean;
};

export type ConversationExport = {
  summary: ConversationSummary;
  records: unknown[];
  truncated: boolean;
};

export type DataExport = {
  exportedAt: number;
  truncated: boolean;
  conversations: ConversationExport[];
};

export type ConversationCalls = {
  "owner.identity": { args: Record<string, never>; result: OwnerIdentity };
  "conversations.bootstrap": {
    args: { clientCreateId?: string; preferConversationId?: string };
    result: OwnerIdentity & { conversationId: string };
  };
  "data.export": { args: Record<string, never>; result: DataExport };
};

export type ConversationViews = {
  "conversations.recent": { args: Record<string, never>; result: ConversationSummary[] };
  "conversations.get": {
    args: { conversationId: string };
    result: ConversationSummary | null;
  };
};

export const RECENT_CONVERSATIONS_LIMIT = 25;
export const CONVERSATION_TITLE_MAX = 56;
export const CONVERSATION_PREVIEW_MAX = 160;
