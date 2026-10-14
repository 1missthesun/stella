import { useEffect, useMemo } from "react";
import type { ConversationSummary } from "@stella/contracts/backend/conversations";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { recallHandoff, rememberForHandoff } from "@/platform/backend/window-handoff";
import {
  cloudConversationsForOwnerSubject,
  isOwnedCloudConversation,
} from "@/features/cloud/cloud-conversation-selection";
import type { useCloudConversationSession } from "./use-cloud-conversation-session";

type CloudConversationSession = ReturnType<typeof useCloudConversationSession>;

export function useShellConversationSource({
  session,
  isPrivate,
  routeConversationId,
}: {
  session: CloudConversationSession;
  isPrivate: boolean;
  routeConversationId: string | null;
}) {
  const { accountScope, ownerSubject } = session;
  const isCloudConversationReady = !isPrivate && session.isCloudConversationReady;
  const recent = useBackendView(
    "conversations.recent",
    isCloudConversationReady ? {} : "skip",
  );
  const handoffKey =
    isCloudConversationReady && ownerSubject
      ? `conversations.recent:${accountScope}:${ownerSubject}`
      : null;
  useEffect(() => {
    if (handoffKey && recent.status === "ready") {
      rememberForHandoff(handoffKey, recent.value);
    }
  }, [handoffKey, recent.status, recent.value]);
  const handedOver = useMemo(
    () => (handoffKey ? recallHandoff<ConversationSummary[]>(handoffKey) : undefined),
    [handoffKey],
  );
  const cloudConversations: ConversationSummary[] | undefined =
    recent.value ?? (recent.status === "loading" ? handedOver : undefined);
  const ownerGeneration = isCloudConversationReady ? session.ownerGeneration : null;

  const scopedCloudConversations = useMemo(
    () =>
      cloudConversationsForOwnerSubject(cloudConversations ?? [], ownerSubject),
    [cloudConversations, ownerSubject],
  );
  const mainCloudConversationId = isCloudConversationReady
    ? session.mainConversationId
    : null;
  const routeIsListedOrPendingCloudConversation = isOwnedCloudConversation(
    scopedCloudConversations,
    routeConversationId,
    accountScope,
    ownerSubject,
  );
  const routeLookupId =
    isCloudConversationReady &&
    cloudConversations !== undefined &&
    routeConversationId &&
    !routeIsListedOrPendingCloudConversation
      ? routeConversationId
      : null;
  const routeLookup = useBackendView(
    "conversations.get",
    routeLookupId ? { conversationId: routeLookupId } : "skip",
  );
  const exactCloudConversation = routeLookupId
    ? routeLookup.status === "loading"
      ? undefined
      : (routeLookup.value ?? null)
    : undefined;

  const mainConversationIsListed = Boolean(
    mainCloudConversationId &&
      scopedCloudConversations.some(
        (conversation) =>
          conversation.conversationId === mainCloudConversationId,
      ),
  );
  const mainLookupId =
    isCloudConversationReady &&
    cloudConversations !== undefined &&
    mainCloudConversationId &&
    mainCloudConversationId !== routeConversationId &&
    !mainConversationIsListed
      ? mainCloudConversationId
      : null;
  const mainLookup = useBackendView(
    "conversations.get",
    mainLookupId ? { conversationId: mainLookupId } : "skip",
  );
  const exactMainCloudConversation = mainLookupId
    ? mainLookup.status === "loading"
      ? undefined
      : (mainLookup.value ?? null)
    : undefined;

  return {
    isCloudConversationReady,
    isLoading: session.isLoading,
    cloudConversations,
    scopedCloudConversations,
    ownerGeneration,
    mainCloudConversationId,
    routeIsListedOrPendingCloudConversation,
    exactCloudConversation,
    mainConversationIsListed,
    exactMainCloudConversation,
  };
}
