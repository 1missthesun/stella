import type { Context } from "@earendil-works/chord";
import type { ExecutionContextSnapshot } from "@stella/contracts/execution-context";
import type { StellaPromptEnvironment } from "@stella/contracts/stella-prompts";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { StellaAgentRole } from "./agent-doc.ts";

export type StellaAgentPromptId = "agents/orchestrator.md" | "agents/general.md";

export type StellaMemory = {
  enabled: boolean;
  main?: string;
};

export type StellaContextSources = {
  readonly env: StellaPromptEnvironment;
  readonly homeFolders?: { readonly home: string; readonly stellaHome: string };
  agentPrompt(id: StellaAgentPromptId, context: Context): Promise<string | undefined>;
  personality(context: Context): Promise<string | undefined>;
  memory(context: Context): Promise<StellaMemory>;
  skillsCatalog(context: Context): Promise<string | undefined>;
  executionContext(conversationId: ConversationId, context: Context): Promise<ExecutionContextSnapshot | undefined>;
  locale?(context: Context): Promise<string | undefined>;
  codeHistory?(agentType: StellaAgentRole["agentType"], context: Context): Promise<boolean>;
  /** Most inline image base64 one model request carries; older images go out as a note. Unset: no bound. */
  readonly requestImageBytes?: number;
};
