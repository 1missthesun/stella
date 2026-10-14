import type { ResolvedLlmRoute } from "../model-routing.js";
import type { RuntimeStore } from "../storage/runtime-store.js";
import type {
  LocalChatAppendEventArgs,
  LocalContextEvent,
} from "../storage/shared.js";
import type { ExtensionRuntimeApi } from "./runtime-api.js";

export type ExtensionServices = {
  /** Mutable user-data home (`~/.stella`): personality, skills, memory, and the live agent prompts under `agents/`. */
  stellaDataDir: string;
  /** Stella application root. */
  stellaAppDir: string;
  /** Runtime SQLite store. Hooks that need durable thread summaries reach in here. */
  store: RuntimeStore;
  /** Stable engine capabilities for extensions loaded outside the app bundle. */
  runtime: ExtensionRuntimeApi;
};

/**
 * Per-emit runtime services attached to lifecycle hook payloads.
 *
 * Some hook events (notably `agent_end`) need values that vary per
 * RUN — `resolvedLlm` is per-turn, `appendLocalChatEvent` /
 * `listLocalChatEvents` come from per-`RuntimeRunOptions` callbacks
 * passed in by the desktop layer. The runtime populates this
 * object at emit time from the live run options; hooks read whichever
 * accessors they need. Every field is optional so hooks must guard
 * before using them and emit sites are free to omit fields they don't
 * have wired (e.g. headless runs without a renderer-side `appendLocalChatEvent`).
 */
export type RuntimeRunServices = {
  /** Resolved LLM route the run used. */
  resolvedLlm?: ResolvedLlmRoute;
  /**
   * Append a local-chat event for this conversation. Routes through the
   * worker server wrapper that fires `localChat:updated`, so renderer
   * subscribers re-fetch reactively.
   */
  appendLocalChatEvent?: (args: LocalChatAppendEventArgs) => void;
  /** Read recent local-chat events. */
  listLocalChatEvents?: (
    conversationId: string,
    maxItems: number,
  ) => LocalContextEvent[];
  /**
   * Resolve the LLM route for a sibling agent type so post-run
   * background passes can run on a different model than the agent
   * that just finalized.
   */
  resolveSubsidiaryLlmRoute?: (agentType: string) => ResolvedLlmRoute;
};
