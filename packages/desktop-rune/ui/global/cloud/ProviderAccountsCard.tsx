import { SettingsCard } from "../../settings/parts";
import { Button, showToast } from "../../kit/compat";
import { useAiAccounts } from "./ai-accounts.styles";
import { useState } from "react";
import { useAuthState } from "@/global/auth/BackendAuthProvider";
import type {
  AgentModelReasoningEffort,
  LegacyCloudExecutionSelection,
} from "@stella/contracts/agent-engine";
import { isEngineConnectionUsable } from "@stella/contracts/backend/engines";
import { DEFAULT_REASONING_EFFORT } from "@stella/contracts/reasoning-effort";
import { useT } from "@/shared/i18n";
import { ChatGptAccountsSection } from "../chatgpt/ChatGptAccountsSection";
import { ClaudeAccountsSection } from "../claude/ClaudeAccountsSection";
import { AntigravityAccountSection } from "../antigravity/AntigravityAccountSection";
import { cloudEnginesApi, useCloudEngines } from "@/features/cloud/cloud-engines-api";
import { publishCloudExecutionSelection } from "@/features/cloud/cloud-execution-store";
import { AiInUse, AiPrimaryAccount } from "./AiProviderSection";
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
  const chosen = connections?.selection ?? connections?.execution;
  const chatEngine = chosen?.engine ?? "stella";
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

  const engineChoice = (engine: "anthropic" | "chatgpt") =>
    isAuthenticated && chatEngine !== engine
      ? {
          onUseEngine: () => void chooseEngine(engine),
          useEngineDisabled: switching || !usableProviders.has(engine),
        }
      : {};

  return (
    <>
      <ClaudeAccountsSection settings={connections} refreshing={refreshing} cloudAvailable={isAuthenticated} engineInUse={isAuthenticated && chatEngine === "anthropic"} {...engineChoice("anthropic")} />
      <ChatGptAccountsSection settings={connections} refreshing={refreshing} cloudAvailable={isAuthenticated} engineInUse={isAuthenticated && chatEngine === "chatgpt"} {...engineChoice("chatgpt")} />
      <AntigravityAccountSection engineInUse={chosen?.engine === "provider" && chosen.provider === "antigravity"} />
      {isAuthenticated && managedModels ? (
        <SettingsCard>
          <AiPrimaryAccount name={t(`${K}.stellaModels`)} meta={t(`${K}.stellaModelsHint`)} status={
              chatEngine === "stella" ? (
                <AiInUse label={t(`${K}.inUse`)} />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="pill-btn"
                  disabled={switching}
                  onClick={() => void chooseEngine("stella")}
                >
                  {t(`${K}.use`)}
                </Button>
              )
            } />
        </SettingsCard>
      ) : null}
    </>
  );
}
