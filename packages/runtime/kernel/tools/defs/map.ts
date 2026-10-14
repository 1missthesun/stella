import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { ToolDefinition } from "../types.js";
import { forkAbortTimer } from "../effect-runtime.js";
import {
  MAP_TOOL_DESCRIPTION,
  MAP_TOOL_NAME,
  MAP_TOOL_PARAMETERS,
  MAP_TOOL_PROMPT_SNIPPET,
  MAP_TOOL_REPLAY,
  MAP_TOOL_SEARCH_TERMS,
  MAP_TOOL_WORKING_TEXT,
} from "./map-def.js";
import {
  MAP_RESOLVE_TIMEOUT_MS,
  parseMapToolArgs,
  resolveMapArtifact,
} from "./map-resolve.js";

export type MapToolOptions = {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
  fetchImpl?: typeof fetch;
};

export const createMapTool = (options: MapToolOptions = {}): ToolDefinition => {
  return {
    name: MAP_TOOL_NAME,
    replay: MAP_TOOL_REPLAY,
    agentTypes: [AGENT_IDS.ORCHESTRATOR],
    demoted: { searchTerms: MAP_TOOL_SEARCH_TERMS },
    description: MAP_TOOL_DESCRIPTION,
    promptSnippet: MAP_TOOL_PROMPT_SNIPPET,
    workingText: MAP_TOOL_WORKING_TEXT,
    parameters: MAP_TOOL_PARAMETERS,
    execute: async (args, _context, extras) => {
      const parsed = parseMapToolArgs(args);
      if ("error" in parsed) return { error: parsed.error };
      const backend = options.getCloudBackendAuth?.() ?? null;
      if (!backend) {
        return { error: "Map lookup failed: sign in to Stella to use maps." };
      }

      const controller = new AbortController();
      const cancelResolveTimer = forkAbortTimer(MAP_RESOLVE_TIMEOUT_MS, () =>
        controller.abort(),
      );
      const onAbort = () => controller.abort();
      extras?.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const outcome = await resolveMapArtifact(parsed.request, {
          backend,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          signal: controller.signal,
        });
        if (!outcome.ok) return { error: outcome.error };
        return { result: outcome.summary, details: { map: outcome.map } };
      } finally {
        cancelResolveTimer();
        extras?.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
};
