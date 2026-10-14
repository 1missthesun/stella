import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useState } from "react";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import type {
  AgentModelReasoningEffort,
  LegacyCloudExecutionSelection,
} from "@stella/contracts/agent-engine";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { DEFAULT_REASONING_EFFORT } from "@stella/contracts/reasoning-effort";
import { Button } from "@/ui/button";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { ChatGptAccountsSection } from "@/features/chatgpt/ChatGptAccountsSection";
import { ClaudeAccountsSection } from "@/features/claude/ClaudeAccountsSection";
import { cloudEnginesApi, useCloudEngines } from "./cloud-engines-api";
import { publishCloudExecutionSelection } from "./cloud-execution-store";
import { useServerFeature } from "@/platform/backend/server-discovery";

const K = "settings.engineAccounts";

export function ProviderAccountsCard() {
  const t = useT();
  const { isAuthenticated } = useAuthState();
  const connections = useCloudEngines(isAuthenticated);
  const [switching, setSwitching] = useState(false);
  const managedModels = useServerFeature("managedModels");

  const usableProviders = new Set<string>(
    (connections?.connections ?? [])
      .filter(isEngineConnectionUsable)
      .map((row) => row.provider),
  );
  const chatEngine = connections?.execution.engine ?? "stella";
  const refreshing = isAuthenticated && connections === undefined;

  const chooseEngine = async (engine: LegacyCloudExecutionSelection["engine"]) => {
    if (engine === chatEngine) return;
    setSwitching(true);
    try {
      const reasoningEffort: AgentModelReasoningEffort =
        connections?.execution.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
      const execution: LegacyCloudExecutionSelection =
        engine === "stella"
          ? {
              engine,
              provider: engine,
              model: "stella/default",
              reasoningEffort,
            }
          : engine === "anthropic"
            ?
              { engine, provider: engine, model: "default", reasoningEffort }
            : { engine, provider: engine, model: "gpt-6.1-sol", reasoningEffort };
      await cloudEnginesApi.setExecution(execution);
      publishCloudExecutionSelection(execution);
    } catch (error) {
      showToast({
        title: error instanceof Error && error.message ? error.message : t(`${K}.errorGeneric`),
        variant: "error",
      });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="settings-card">
      <SettingsCardTitle titleKey={`${K}.cardTitle`} />
      <ChatGptAccountsSection
        settings={connections}
        refreshing={refreshing}
        cloudAvailable={isAuthenticated}
      />
      <ClaudeAccountsSection
        settings={connections}
        refreshing={refreshing}
        cloudAvailable={isAuthenticated}
      />
      {isAuthenticated ? (
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t(`${K}.runsOnLabel`)}</div>
          </div>
          <div className="settings-row-control engine-account-controls">
            {managedModels ? (
              <Button
                type="button"
                variant="ghost"
                className={`pill-btn${chatEngine === "stella" ? " pill-btn--active" : ""}`}
                aria-pressed={chatEngine === "stella"}
                onClick={() => void chooseEngine("stella")}
                disabled={switching}
              >
                Stella
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className={`pill-btn${chatEngine === "anthropic" ? " pill-btn--active" : ""}`}
              aria-pressed={chatEngine === "anthropic"}
              onClick={() => void chooseEngine("anthropic")}
              disabled={switching || !usableProviders.has("anthropic")}
              title={usableProviders.has("anthropic") ? undefined : t(`${K}.needsClaudeCloud`)}
            >
              Claude
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={`pill-btn${chatEngine === "chatgpt" ? " pill-btn--active" : ""}`}
              aria-pressed={chatEngine === "chatgpt"}
              onClick={() => void chooseEngine("chatgpt")}
              disabled={switching || !usableProviders.has("chatgpt")}
              title={usableProviders.has("chatgpt") ? undefined : t(`${K}.needsChatgptCloud`)}
            >
              ChatGPT
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
