import type { CloudConversation } from "./cloud-api";

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

export const isOwnedCloudConversation = (
  conversations: readonly CloudConversation[],
  conversationId: string | null,
  ownerSubject: string | null,
): boolean =>
  Boolean(
    conversationId &&
      conversations.some(
        (conversation) =>
          conversation.conversationId === conversationId &&
          cloudConversationBelongsToOwnerSubject(conversation, ownerSubject),
      ),
  );

export const resolveCloudConversationRoute = (args: {
  conversations: readonly CloudConversation[];
  routeConversationId: string | null;
  mainConversationId: string | null;
  ownerSubject: string | null;
}): string | null => {
  for (const candidate of [args.routeConversationId, args.mainConversationId]) {
    if (
      isOwnedCloudConversation(
        args.conversations,
        candidate,
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
  ownerSubject: string | null;
}): string | null =>
  resolveCloudConversationRoute({
    conversations: args.conversations,
    routeConversationId: args.isOnChatRoute ? args.routeConversationId : null,
    mainConversationId: args.isOnChatRoute ? null : args.mainConversationId,
    ownerSubject: args.ownerSubject,
  });
