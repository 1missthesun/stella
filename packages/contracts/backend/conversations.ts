import type { CloudExecutionSelection } from "../agent-engine.js";

/**
 * Conversations and the owner identity, served from the owner's object.
 * The conversation's transcript stays in its own `OrchestratorSession`; this
 * is the index a client lists and selects from.
 */

export type ConversationSummary = {
  /** The account this row belongs to; clients drop rows for any other. */
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
  /** Changes when the owner resets or deletes their data; fences stale work. */
  ownerGeneration: string;
  isAnonymous: boolean;
};

export type ConversationCalls = {
  "owner.identity": { args: Record<string, never>; result: OwnerIdentity };
  /**
   * Create a conversation without starting a turn. `clientCreateId` makes a
   * retried create return the same conversation.
   */
  "conversations.create": {
    args: {
      clientCreateId: string;
      requestedConversationId?: string;
      title?: string;
      execution?: CloudExecutionSelection;
    };
    result: ConversationSummary;
  };
  /**
   * The account's main conversation plus the owner identity: everything a
   * client needs before showing its chat. Every client opens the same main
   * conversation. The server pins it the first time any client asks: the
   * `preferConversationId` hint when it is a live conversation, else the most
   * recently used one, else a new empty one. Deleting it re-pins on the next
   * call. Older phone builds still send `clientCreateId`; it is ignored.
   */
  "conversations.bootstrap": {
    args: { clientCreateId?: string; preferConversationId?: string };
    result: OwnerIdentity & { conversationId: string };
  };
  /** Sidebar history, newest first; pass the last row back as the cursor. */
  "conversations.page": {
    args: {
      before?: { updatedAt: number; conversationId: string };
      limit?: number;
    };
    result: { conversations: ConversationSummary[]; hasMore: boolean };
  };
};

export type ConversationViews = {
  /** The newest conversations, for selection and the sidebar's first page. */
  "conversations.recent": { args: Record<string, never>; result: ConversationSummary[] };
  "conversations.get": {
    args: { conversationId: string };
    result: ConversationSummary | null;
  };
};

export const RECENT_CONVERSATIONS_LIMIT = 25;
export const CONVERSATION_TITLE_MAX = 56;
export const CONVERSATION_PREVIEW_MAX = 160;
