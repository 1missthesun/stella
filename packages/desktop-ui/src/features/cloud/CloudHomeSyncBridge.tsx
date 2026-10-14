import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { getAuthTokenForSubject } from "@/global/auth/services/auth-token";
import { backendClient, backendUrl } from "@/platform/backend/backend-client";
import { uiState } from "@/platform/ui-state";
import {
  cloudHomeSyncRetryStore,
  cloudHomeSyncStatusStore,
  runCloudHomeSync,
} from "./cloud-home-sync";

const unavailable = (accountScope: string, message: string) =>
  cloudHomeSyncStatusStore.set({
    accountScope,
    phase: "unavailable",
    skillsUploaded: 0,
    skillsCloudWins: 0,
    skipped: 0,
    warnings: [],
    issues: [{ code: "not_available", message }],
  });

const SKILL_HEADS_TIMEOUT_MS = 20_000;

export function CloudHomeSyncBridge() {
  const {
    isCloudConversationReady,
    accountScope,
    identityRevision,
    ownerSubject,
  } = useCloudConversationSession();
  const retry = useSyncExternalStore(
    cloudHomeSyncRetryStore.subscribe,
    cloudHomeSyncRetryStore.getSnapshot,
    cloudHomeSyncRetryStore.getServerSnapshot,
  );
  const identityKey = `${accountScope}:${identityRevision}:${ownerSubject ?? "missing"}`;
  const activeIdentityRef = useRef(identityKey);

  useLayoutEffect(() => {
    activeIdentityRef.current = identityKey;
    cloudHomeSyncStatusStore.reset(
      isCloudConversationReady ? accountScope : null,
    );
  }, [accountScope, isCloudConversationReady, identityKey]);

  useEffect(() => {
    if (!isCloudConversationReady) {
      cloudHomeSyncStatusStore.reset(null);
      return;
    }
    const cloudHome = window.electronAPI?.cloudHome;
    if (!cloudHome) {
      unavailable(
        accountScope,
        "Local Cloud Home import is available in the Stella desktop app.",
      );
      return;
    }
    if (!backendUrl) {
      unavailable(
        accountScope,
        "Cloud Home is not available in this deployment.",
      );
      return;
    }

    const controller = new AbortController();
    const scopeAtStart = accountScope;
    const identityAtStart = identityKey;
    void (async () => {
      const token = ownerSubject
        ? await getAuthTokenForSubject(ownerSubject)
        : null;
      if (
        controller.signal.aborted ||
        activeIdentityRef.current !== identityAtStart
      ) {
        return;
      }
      if (!token) {
        unavailable(scopeAtStart, "Sign in again to synchronize Cloud Home.");
        return;
      }
      await runCloudHomeSync({
        accountScope: scopeAtStart,
        expectedSubject: ownerSubject!,
        builderOrigin: backendUrl,
        token,
        scanLocal: () => cloudHome.scanLocal(scopeAtStart),
        readImportOwnership: cloudHome.getImportOwnership,
        readSkillHeads: () =>
          backendClient.read(
            "skills.heads",
            { clientScope: scopeAtStart },
            {
              signal: controller.signal,
              timeoutMs: SKILL_HEADS_TIMEOUT_MS,
              timeoutMessage: "Cloud skills did not load.",
            },
          ),
        deleteSkillMirror: ({ slug, expectedRevision }) =>
          backendClient.call("skills.deleteMirrored", {
            clientScope: scopeAtStart,
            slug,
            expectedRevision,
          }),
        cursorStore: uiState,
        signal: controller.signal,
        onStatus: (status) => {
          if (
            !controller.signal.aborted &&
            activeIdentityRef.current === identityAtStart
          ) {
            cloudHomeSyncStatusStore.set(status);
          }
        },
      });
    })().catch(() => {
      if (
        !controller.signal.aborted &&
        activeIdentityRef.current === identityAtStart
      ) {
        unavailable(
          scopeAtStart,
          "Cloud Home could not be synchronized. Try again.",
        );
      }
    });
    return () => controller.abort();
  }, [
    accountScope,
    isCloudConversationReady,
    identityKey,
    ownerSubject,
    retry,
  ]);

  return null;
}
