import { useLayoutEffect } from "react";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import {
  mirrorCloudMemoryPreferenceLocally,
  restoreLocalMemoryChoice,
} from "./cloud-memory-local-mirror";
import { useCloudMemoryPreference } from "./use-cloud-memory-preference";

function AccountMemoryPreferenceBridge() {
  const preference = useCloudMemoryPreference();
  const desired =
    preference.status === "synced" && preference.preference
      ? preference.preference.memoryEnabled
      : false;
  const settled = preference.status === "synced" && preference.preference !== null;

  useLayoutEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (cancelled || retryTimer !== null) return;
      retryTimer = globalThis.setTimeout(() => {
        retryTimer = null;
        void apply();
      }, 1_000);
    };
    const apply = async () => {
      const failClosed = await mirrorCloudMemoryPreferenceLocally(false, {
        settled: settled && !desired,
      }).catch(() => false);
      if (cancelled) return;
      if (!failClosed) {
        scheduleRetry();
        return;
      }
      if (!desired) return;
      const mirrored = await mirrorCloudMemoryPreferenceLocally(true, {
        settled,
      }).catch(() => false);
      if (!cancelled && !mirrored) scheduleRetry();
    };

    void apply();
    return () => {
      cancelled = true;
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    };
  }, [desired, settled]);

  return null;
}

function SignedOutMemoryPreferenceBridge() {
  useLayoutEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const apply = async () => {
      const restored = await restoreLocalMemoryChoice().catch(() => false);
      if (cancelled || restored) return;
      retryTimer = globalThis.setTimeout(() => {
        retryTimer = null;
        void apply();
      }, 1_000);
    };
    void apply();
    return () => {
      cancelled = true;
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    };
  }, []);
  return null;
}

export function CloudMemoryPreferenceBridge() {
  const mode = useCloudConversationSession();
  const gate = mode.sessionGate;
  if (!gate.sessionIsLoading && !gate.hasSession) {
    return <SignedOutMemoryPreferenceBridge />;
  }
  if (gate.sessionIsLoading && !gate.hasSession) return null;
  const key = mode.isCloudConversationReady
    ? `${mode.accountScope}:${mode.identityRevision}:${mode.ownerSubject ?? "missing"}`
    : `unavailable:${mode.accountScope}:${mode.identityRevision}`;
  return <AccountMemoryPreferenceBridge key={key} />;
}
