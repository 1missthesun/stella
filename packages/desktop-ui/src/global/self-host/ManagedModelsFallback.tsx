import { useEffect, useRef } from "react";
import { useClaudeLocalAccounts } from "@/features/claude/use-claude-local-accounts";
import { useChatGptProfiles } from "@/features/chatgpt/use-chatgpt-profiles";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/global/settings/lib/provider-default-models";
import { switchEngine } from "@/global/settings/lib/switch-engine";

/**
 * A self-hosted server without Stella's own models can't answer on the
 * "Stella" engine. When this desktop is still on it (it was set up on
 * stella.sh, or never chose), move it once to the Claude or ChatGPT account
 * signed in on this computer. A provider API key on the default engine is a
 * real choice and stays.
 */
export function ManagedModelsFallback() {
  const claude = useClaudeLocalAccounts();
  const chatgpt = useChatGptProfiles();
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !claude.loaded || !chatgpt.loaded) return;
    const target = claude.signedIn ? "claude_code_local" : chatgpt.usable ? "codex_cli" : null;
    if (!target) return;
    done.current = true;
    void (async () => {
      const preferences = await window.electronAPI?.system?.getLocalModelPreferences?.();
      if (!preferences || (preferences.agentRuntimeEngine ?? "default") !== "default") return;
      const provider = preferences.modelOverrides?.orchestrator?.split("/")[0];
      if (provider && DEFAULT_MODEL_BY_PROVIDER[provider]) return;
      await switchEngine(target);
    })().catch(() => {
      done.current = false;
    });
  }, [chatgpt.loaded, chatgpt.usable, claude.loaded, claude.signedIn]);

  return null;
}
