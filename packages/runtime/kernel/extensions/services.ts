import type { ResolvedLlmRoute } from "../model-routing.js";
import type { RuntimeStore } from "../storage/runtime-store.js";
import type {
  LocalChatAppendEventArgs,
  LocalContextEvent,
} from "@stella/node-shared/storage/shared.js";
import type { ExtensionRuntimeApi } from "./runtime-api.js";

export type ExtensionServices = {
  stellaDataDir: string;
  stellaAppDir: string;
  store: RuntimeStore;
  runtime: ExtensionRuntimeApi;
};

export type RuntimeRunServices = {
  resolvedLlm?: ResolvedLlmRoute;
  appendLocalChatEvent?: (args: LocalChatAppendEventArgs) => void;
  listLocalChatEvents?: (
    conversationId: string,
    maxItems: number,
  ) => LocalContextEvent[];
  resolveSubsidiaryLlmRoute?: (agentType: string) => ResolvedLlmRoute;
};
