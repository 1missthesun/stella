import type { Context } from "@earendil-works/chord";
import type { ExecutionContextSnapshot } from "@stella/contracts/execution-context";
import type { StellaPromptEnvironment } from "@stella/contracts/stella-prompts";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { StellaAgentRole } from "./agent-doc.ts";

export type StellaAgentPromptId = "agents/orchestrator.md" | "agents/general.md";

export type StellaMemory = {
  enabled: boolean;
  main?: string;
  rules?: string;
};

export type StellaContextSources = {
  readonly env: StellaPromptEnvironment;
  readonly homeFolders?: { readonly home: string; readonly stellaHome: string };
  agentPrompt(id: StellaAgentPromptId, context: Context): Promise<string | undefined>;
  personality(context: Context): Promise<string | undefined>;
  memory(context: Context): Promise<StellaMemory>;
  /** The user's standing rules (`memories/rules.md`) for a task's or helper's prompt; undefined when memory is off. */
  rules?(context: Context): Promise<string | undefined>;
  skillsCatalog(context: Context): Promise<string | undefined>;
  executionContext(conversationId: ConversationId, context: Context): Promise<ExecutionContextSnapshot | undefined>;
  locale?(context: Context): Promise<string | undefined>;
  codeHistory?(agentType: StellaAgentRole["agentType"], context: Context): Promise<boolean>;
};
