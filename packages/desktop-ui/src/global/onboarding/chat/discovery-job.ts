import { useSyncExternalStore } from "react";
import type { DiscoveryCategory } from "@stella/contracts/discovery";
import type { OnboardingStarter } from "@stella/contracts/desktop/onboarding";
import { synthesizeCoreMemory } from "@/global/onboarding/services/synthesis";
import {
  getAuthSessionSnapshot,
  subscribeAuthSession,
} from "@/global/auth/services/auth-session";
import { isConnectedAccountSession } from "@/global/auth/hooks/use-auth-session-state";
import { setPendingDiscoveryWelcome } from "./pending-handoff";

export type DiscoveryJobStatus =
  | "idle"
  | "collecting"
  | "waiting_for_account"
  | "synthesizing"
  | "saving"
  | "done"
  | "failed";

export type DiscoveryJobResult = {
  coreMemory: string;
  welcomeMessage: string;
  profileHighlights: string[];
  starters: OnboardingStarter[];
};

export type DiscoveryJobSnapshot = {
  status: DiscoveryJobStatus;
  result: DiscoveryJobResult | null;
  error: string | null;
};

export type DiscoveryJobInput = {
  categories: DiscoveryCategory[];
  selectedBrowser?: string;
  selectedProfile?: string;
};

const IDLE: DiscoveryJobSnapshot = { status: "idle", result: null, error: null };

let snapshot: DiscoveryJobSnapshot = IDLE;
let generation = 0;
const listeners = new Set<() => void>();

const publish = (next: DiscoveryJobSnapshot) => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getDiscoveryJobSnapshot = () => snapshot;

export function useDiscoveryJob(): DiscoveryJobSnapshot {
  return useSyncExternalStore(subscribe, getDiscoveryJobSnapshot, () => IDLE);
}

export const resetDiscoveryJob = () => {
  generation += 1;
  publish(IDLE);
};

const fail = (jobGeneration: number, error: string, details?: unknown) => {
  if (jobGeneration !== generation) return;
  console.error("[onboarding-chat] Discovery failed:", error, details ?? "");
  publish({ status: "failed", result: null, error });
};

const hasAccount = () =>
  isConnectedAccountSession(getAuthSessionSnapshot().data);

const waitForAccount = (isCurrent: () => boolean): Promise<boolean> =>
  new Promise((resolve) => {
    if (hasAccount()) {
      resolve(true);
      return;
    }
    const unsubscribe = subscribeAuthSession(() => {
      if (!isCurrent()) {
        unsubscribe();
        resolve(false);
        return;
      }
      if (!hasAccount()) return;
      unsubscribe();
      resolve(true);
    });
  });

export const startDiscoveryJob = (input: DiscoveryJobInput) => {
  generation += 1;
  const jobGeneration = generation;
  const isCurrent = () => jobGeneration === generation;
  publish({ status: "collecting", result: null, error: null });

  void (async () => {
    try {
      const discovery = window.electronAPI?.discovery;
      if (!discovery?.collectAllSignals) {
        fail(jobGeneration, "Discovery IPC is unavailable.");
        return;
      }

      const collected = await discovery.collectAllSignals({
        categories: input.categories,
        selectedBrowser: input.selectedBrowser,
        selectedProfile: input.selectedProfile,
      });
      if (!isCurrent()) return;
      if (!collected) {
        fail(jobGeneration, "Signal collection returned no result.");
        return;
      }
      if (collected.error) {
        fail(jobGeneration, "Signal collection failed.", collected.error);
        return;
      }
      const formattedSections = collected.formattedSections;
      if (!formattedSections || Object.keys(formattedSections).length === 0) {
        fail(
          jobGeneration,
          "Signal collection returned no usable discovery data.",
          collected,
        );
        return;
      }

      if (!hasAccount()) {
        publish({ status: "waiting_for_account", result: null, error: null });
        if (!(await waitForAccount(isCurrent))) return;
      }

      publish({ status: "synthesizing", result: null, error: null });
      const synthesis = await synthesizeCoreMemory(formattedSections);
      if (!isCurrent()) return;
      if (!synthesis.coreMemory) {
        fail(
          jobGeneration,
          "Core memory synthesis returned an empty result.",
          synthesis,
        );
        return;
      }

      publish({ status: "saving", result: null, error: null });
      const includeLocation =
        input.categories.includes("browsing_bookmarks") ||
        input.categories.includes("apps_system");
      const coreMemoryWrite = discovery.writeCoreMemory
        ? await discovery.writeCoreMemory(synthesis.coreMemory, {
            includeLocation,
          })
        : {
            ok: false as const,
            error: "Core memory write IPC is unavailable.",
          };
      if (!isCurrent()) return;
      if (!coreMemoryWrite?.ok) {
        fail(jobGeneration, "Failed to save discovery memory.", {
          coreMemoryWrite,
        });
        return;
      }

      if (synthesis.welcomeMessage) {
        setPendingDiscoveryWelcome(synthesis.welcomeMessage);
      }

      publish({
        status: "done",
        error: null,
        result: {
          coreMemory: synthesis.coreMemory,
          welcomeMessage: synthesis.welcomeMessage,
          profileHighlights: synthesis.profileHighlights ?? [],
          starters: synthesis.starters ?? [],
        },
      });
    } catch (error) {
      fail(jobGeneration, "Discovery failed unexpectedly.", error);
    }
  })();
};
