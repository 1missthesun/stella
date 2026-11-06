import { useLayoutEffect } from "react";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import {
  mirrorCloudMemoryPreferenceLocally,
  restoreLocalMemoryChoice,
} from "./cloud-memory-local-mirror";
import { useCloudMemoryPreference } from "./use-cloud-memory-preference";

type MemorySource =
  | { kind: "signed_out" }
  | { kind: "account_unknown" }
  | { kind: "account"; memoryEnabled: boolean };

const writeLocalMemory = (source: MemorySource): Promise<boolean> => {
  switch (source.kind) {
    case "signed_out":
      return restoreLocalMemoryChoice();
    case "account_unknown":
      return restoreLocalMemoryChoice({ whenUnknown: "keep" });
    case "account":
      return mirrorCloudMemoryPreferenceLocally(source.memoryEnabled, {
        settled: true,
      });
  }
};

function useLocalMemoryMirror(
  kind: MemorySource["kind"],
  memoryEnabled: boolean | null,
) {
  useLayoutEffect(() => {
    const source: MemorySource =
      kind === "account" && memoryEnabled !== null
        ? { kind, memoryEnabled }
        : kind === "signed_out"
          ? { kind }
          : { kind: "account_unknown" };
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const apply = async () => {
      const done = await writeLocalMemory(source).catch(() => false);
      if (cancelled || done) return;
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
  }, [kind, memoryEnabled]);
}

function AccountMemoryPreferenceBridge() {
  const preference = useCloudMemoryPreference();
  const known = preference.status === "synced" && preference.preference;
  useLocalMemoryMirror(
    known ? "account" : "account_unknown",
    known ? known.memoryEnabled : null,
  );
  return null;
}

function SignedOutMemoryPreferenceBridge() {
  useLocalMemoryMirror("signed_out", null);
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
