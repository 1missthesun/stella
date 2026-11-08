import { useCallback, useEffect } from "react";
import { setBackendAccount } from "@/platform/backend/backend-client";
import {
  refreshOwnerIdentity,
  useOwnerIdentity,
} from "@/platform/backend/use-owner-identity";
import { readActiveCloudConversationIdCache } from "@/features/cloud/cloud-conversation-cache";
import { useAuthBootstrapState, useAuthState } from "../BackendAuthProvider";
import {
  resolveCloudConversationSession,
  type CloudConversationSessionGate,
} from "../lib/cloud-conversation-session";
import { useAuthSessionState } from "./use-auth-session-state";
import { reportCloudReadiness } from "@/features/cloud/cloud-readiness-timing";
import {
  isAccountScope,
  readOwnerGeneration,
  rememberOwnerGeneration,
} from "@/features/cloud/paused-account";

export function useCloudConversationSession() {
  const auth = useAuthState();
  const session = useAuthSessionState();
  const authBootstrap = useAuthBootstrapState();
  const expectedSubject = session.user?.id?.trim() || null;
  const ownerSubject = expectedSubject;
  const shouldConfirmIdentity = Boolean(
    authBootstrap.status === "ready" &&
      !session.isLoading &&
      session.hasSession &&
      expectedSubject &&
      auth.isAuthenticated,
  );
  const accountKey =
    shouldConfirmIdentity && ownerSubject
      ? `${ownerSubject}\u0000${session.identityRevision}`
      : null;
  useEffect(() => {
    if (!session.isLoading) setBackendAccount(accountKey);
  }, [accountKey, session.isLoading]);
  const { identity } = useOwnerIdentity(
    accountKey,
    accountKey ? readActiveCloudConversationIdCache(session.cacheScope) : null,
  );
  const refreshMainConversation = useCallback(() => {
    if (accountKey) refreshOwnerIdentity(accountKey);
  }, [accountKey]);
  const identityConfirmed = Boolean(
    identity && ownerSubject && identity.ownerId === ownerSubject,
  );
  const sessionGate: CloudConversationSessionGate = {
    hasSession: session.hasSession,
    sessionIsLoading: session.isLoading,
    authIsAuthenticated: auth.isAuthenticated,
    authIsLoading: auth.isLoading,
    hasExpectedSubject: Boolean(expectedSubject),
    authBootstrapReady: authBootstrap.status === "ready",
    authBootstrapFailed: authBootstrap.status === "failed",
  };
  const confirmedOwnerGeneration = identityConfirmed
    ? (identity?.ownerGeneration ?? null)
    : null;
  useEffect(() => {
    if (confirmedOwnerGeneration) {
      rememberOwnerGeneration(session.cacheScope, confirmedOwnerGeneration);
    }
  }, [confirmedOwnerGeneration, session.cacheScope]);
  // The account's session ended without the user signing out: its chat stays
  // readable from this computer's copy until the same account signs back in.
  const pausedOwnerGeneration =
    authBootstrap.status === "reauth_required" &&
    session.hasSession &&
    Boolean(expectedSubject) &&
    isAccountScope(session.cacheScope)
      ? readOwnerGeneration(session.cacheScope)
      : null;
  const mode = resolveCloudConversationSession({
    ...sessionGate,
    identityConfirmed,
    identityIsLoading: shouldConfirmIdentity && identity === undefined,
  });
  useEffect(() => {
    if (authBootstrap.status === "ready") {
      reportCloudReadiness("cloud.auth-bootstrap-ready", {
        outcome: "success",
      });
    }
    if (!session.isLoading && session.hasSession) {
      reportCloudReadiness("cloud.session-ready", { outcome: "success" });
    }
    if (!auth.isLoading && auth.isAuthenticated) {
      reportCloudReadiness("cloud.auth-ready", { outcome: "success" });
    }
    if (identityConfirmed) {
      reportCloudReadiness("cloud.identity-confirmed", { outcome: "success" });
    }
    if (mode.isCloudConversationReady) {
      reportCloudReadiness("cloud.conversation-ready", { outcome: "success" });
    }
  }, [
    authBootstrap.status,
    auth.isAuthenticated,
    auth.isLoading,
    identityConfirmed,
    mode.isCloudConversationReady,
    session.hasSession,
    session.isLoading,
  ]);
  return {
    ...mode,
    sessionGate,
    accountScope: session.cacheScope,
    expectedSubject,
    ownerSubject,
    ownerGeneration: confirmedOwnerGeneration,
    isCloudConversationPaused: pausedOwnerGeneration !== null,
    pausedOwnerGeneration,
    accountUser: session.user,
    mainConversationId: identityConfirmed ? (identity?.conversationId ?? null) : null,
    refreshMainConversation,
    identityRevision: session.identityRevision,
    error: authBootstrap.error,
    authBootstrapStatus: authBootstrap.status,
    retryAuthBootstrap: authBootstrap.retryAuthBootstrap,
  };
}
