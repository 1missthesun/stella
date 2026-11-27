import { useEffect } from "react";
import { uiState } from "@/platform/ui-state";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { startUsageNudges } from "@/features/nudges/usage-nudges-store";
import { switchEngine } from "@/global/settings/lib/switch-engine";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/global/settings/lib/provider-default-models";
import { seedPiChatWelcome } from "@/features/chat/pi/pi-chat-store";

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

// The welcome goes into the first chat this install opens. A chat kept on this
// computer gets it here; an account's chat already has the cloud's.
export function useFirstRunWelcome(conversationId: string | null): void {
  useEffect(() => {
    if (!conversationId || uiState.getItem(WELCOME_PENDING_KEY) !== "1") return;
    if (!conversationId.startsWith("local_")) {
      uiState.removeItem(WELCOME_PENDING_KEY);
      return;
    }
    if (seeding.has(conversationId)) return;
    seeding.add(conversationId);
    void seedPiChatWelcome(conversationId)
      .then((reached) => {
        if (reached !== null) uiState.removeItem(WELCOME_PENDING_KEY);
      })
      .catch((error: unknown) => console.warn("[first-run] Couldn't add the welcome", error))
      .finally(() => seeding.delete(conversationId));
  }, [conversationId]);
}
