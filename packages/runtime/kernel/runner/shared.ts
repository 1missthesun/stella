import { LOCAL_CONTEXT_EVENT_TYPES } from "../storage/shared.js";
import { readConfiguredBackendUrl as sanitizeStellaBase } from "@stella/contracts/stella-api";
import { isOrchestratorAgentType } from "@stella/contracts/agent-runtime";
import { readRuntimePrompt } from "../prompts/home-prompts.js";

export const DEFAULT_MAX_AGENT_DEPTH = 8;
export const LOCAL_HISTORY_RESERVE_TOKENS = 16_384;
export const MIN_LOCAL_HISTORY_TOKENS = 8_000;
export {
  LOCAL_CONTEXT_EVENT_TYPES,
  sanitizeStellaBase,
};

export const defaultPromptForAgentType = (
  agentType: string,
  _stellaDataDir?: string,
): string =>
  readRuntimePrompt(
    isOrchestratorAgentType(agentType)
      ? "fallback-orchestrator"
      : "fallback-subagent",
  ) ?? "";

// Kept as runner/shared re-exports for existing context builders. The
// dependency-light module is also used by thread-runtime at compaction
// boundaries without creating a runner/session import cycle.
export {
  readCoreMemory,
  readMemoryIndexDoc,
  readUserProfileDoc,
} from "../memory/resident-docs.js";
