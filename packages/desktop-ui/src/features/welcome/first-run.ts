import { useEffect } from "react";
import { uiState } from "@/platform/ui-state";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { startUsageNudges } from "@/features/nudges/usage-nudges-store";
import { switchEngine } from "@/global/settings/lib/switch-engine";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/global/settings/lib/provider-default-models";
import { seedPiChatWelcome } from "@/features/chat/pi/pi-chat-store";
import { runtimeUnavailable } from "@/features/chat/pi/desktop-send-outbox";

// A new install goes straight to the chat. Its first chat opens with Stella's
// welcome message, and that message's buttons do what setup used to.

const WELCOME_PENDING_KEY = "stella-welcome-pending";

const claudeCodeReady = async (): Promise<boolean> => {
  const accounts = await window.electronAPI?.system?.listClaudeLocalAccounts?.().catch(() => null);
  return Boolean(accounts?.cliInstalled && accounts.configs.some((config) => config.loggedIn));
};

// Someone already signed in to Claude Code gets it as their AI, unless they
// picked something else before.
const pickDefaultEngine = async (): Promise<void> => {
  const preferences = await window.electronAPI?.system?.getLocalModelPreferences?.().catch(() => null);
  if (!preferences || (preferences.agentRuntimeEngine ?? "default") !== "default") return;
  const provider = preferences.modelOverrides?.orchestrator?.split("/")[0];
  if (provider && DEFAULT_MODEL_BY_PROVIDER[provider]) return;
  if (await claudeCodeReady()) await switchEngine("claude_code_local");
};

export const beginFirstRun = (): void => {
  uiState.setItem(WELCOME_PENDING_KEY, "1");
  startUsageNudges(false);
  recordAnonymousCount({ type: "setup_step", step: "chat" });
  void pickDefaultEngine().catch((error: unknown) => {
    console.warn("[first-run] Couldn't pick the default AI", error);
  });
};

const seeding = new Set<string>();
const RETRY_MS = [250, 500, 1_000, 2_000, 4_000];

// The welcome goes into the first chat this install opens. A chat kept on this
// computer gets it here; an account's chat already has the cloud's. A first
// launch often opens the chat before Stella's runtime has connected, so the
// welcome waits for it.
export function useFirstRunWelcome(conversationId: string | null): void {
  useEffect(() => {
    if (!conversationId || uiState.getItem(WELCOME_PENDING_KEY) !== "1") return;
    if (!conversationId.startsWith("local_")) {
      uiState.removeItem(WELCOME_PENDING_KEY);
      return;
    }
    if (seeding.has(conversationId)) return;
    seeding.add(conversationId);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const retry = () => {
      if (!live) return;
      timer = setTimeout(seed, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
      attempt += 1;
    };
    const seed = () => {
      if (!live || uiState.getItem(WELCOME_PENDING_KEY) !== "1") return;
      void seedPiChatWelcome(conversationId).then(
        (reached) => {
          if (reached === null) return retry();
          uiState.removeItem(WELCOME_PENDING_KEY);
        },
        (error: unknown) => {
          if (runtimeUnavailable(error)) return retry();
          console.warn("[first-run] Couldn't add the welcome", error);
        },
      );
    };
    seed();
    return () => {
      live = false;
      clearTimeout(timer);
      seeding.delete(conversationId);
    };
  }, [conversationId]);
}
