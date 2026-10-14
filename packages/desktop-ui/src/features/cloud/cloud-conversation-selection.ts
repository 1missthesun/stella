import type { CloudConversation } from "./cloud-api";

const PENDING_CREATE_TTL_MS = 30_000;
type PendingCreatedConversation = {
  expiresAt: number;
  accountScope: string;
};
const pendingCreatedConversations = new Map<
  string,
  PendingCreatedConversation
>();

export const cloudConversationBelongsToOwnerSubject = (
  conversation: Pick<CloudConversation, "ownerId">,
  ownerSubject: string | null,
): boolean => ownerSubject !== null && conversation.ownerId === ownerSubject;

export const cloudConversationsForOwnerSubject = (
  conversations: readonly CloudConversation[],
  ownerSubject: string | null,
): CloudConversation[] =>
  conversations.filter((conversation) =>
    cloudConversationBelongsToOwnerSubject(conversation, ownerSubject),
  );

const prune = (now = Date.now()): void => {
  for (const [conversationId, pending] of pendingCreatedConversations) {
    if (pending.expiresAt <= now) {
      pendingCreatedConversations.delete(conversationId);
    }
  }
};

export const markCloudConversationCreated = (
  conversationId: string,
  accountScope: string,
): void => {
  prune();
  pendingCreatedConversations.set(conversationId, {
    expiresAt: Date.now() + PENDING_CREATE_TTL_MS,
    accountScope,
  });
};

export const acknowledgeCloudConversation = (conversationId: string): void => {
  pendingCreatedConversations.delete(conversationId);
};

export const isPendingCloudConversation = (
  conversationId: string,
  accountScope: string,
): boolean => {
  prune();
  return (
    pendingCreatedConversations.get(conversationId)?.accountScope ===
    accountScope
  );
};

export const isOwnedCloudConversation = (
  conversations: readonly CloudConversation[],
  conversationId: string | null,
  accountScope: string,
  ownerSubject: string | null,
): boolean =>
  Boolean(
    conversationId &&
      (conversations.some(
        (conversation) =>
          conversation.conversationId === conversationId &&
          cloudConversationBelongsToOwnerSubject(conversation, ownerSubject),
      ) ||
        isPendingCloudConversation(conversationId, accountScope)),
  );

export const resolveCloudConversationRoute = (args: {
  conversations: readonly CloudConversation[];
  routeConversationId: string | null;
  mainConversationId: string | null;
  accountScope: string;
  ownerSubject: string | null;
}): string | null => {
  for (const candidate of [args.routeConversationId, args.mainConversationId]) {
    if (
      isOwnedCloudConversation(
        args.conversations,
        candidate,
        args.accountScope,
        args.ownerSubject,
      )
    ) {
      return candidate;
    }
  }
  return null;
};

export const resolveCloudConversationForShell = (args: {
  isOnChatRoute: boolean;
  conversations: readonly CloudConversation[];
  routeConversationId: string | null;
  mainConversationId: string | null;
  accountScope: string;
  ownerSubject: string | null;
}): string | null =>
  resolveCloudConversationRoute({
    conversations: args.conversations,
    routeConversationId: args.isOnChatRoute ? args.routeConversationId : null,
    mainConversationId: args.isOnChatRoute ? null : args.mainConversationId,
    accountScope: args.accountScope,
    ownerSubject: args.ownerSubject,
  });
