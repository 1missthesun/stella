import path from "node:path";

import type { ParsedAgent } from "./types.js";
import { loadParsedAgentsFromDir } from "./markdown-agent-loader.js";

export const loadBundledAgents = (): ParsedAgent[] => [];

export const loadHomeAgentsWithMetadata = (
  stellaDataDir: string,
  agentMetadataDir: string | URL,
): ParsedAgent[] => {
  const metadataById = new Map(
    loadParsedAgentsFromDir(agentMetadataDir).map((agent) => [agent.id, agent]),
  );
  return loadParsedAgentsFromDir(path.join(stellaDataDir, "agents")).map(
    (homeAgent) => {
      const metadata = metadataById.get(homeAgent.id);
      if (!metadata) return homeAgent;
      return {
        id: metadata.id,
        name: metadata.name,
        description: metadata.description,
        systemPrompt: homeAgent.systemPrompt,
        agentTypes: metadata.agentTypes,
        ...(metadata.toolsAllowlist
          ? { toolsAllowlist: metadata.toolsAllowlist }
          : {}),
        ...(metadata.model ? { model: metadata.model } : {}),
        ...(typeof metadata.maxAgentDepth === "number"
          ? { maxAgentDepth: metadata.maxAgentDepth }
          : {}),
      };
    },
  );
};

const agentKeys = (agent: ParsedAgent): Set<string> =>
  new Set([agent.id, ...agent.agentTypes]);

const agentsOverlap = (left: ParsedAgent, right: ParsedAgent): boolean => {
  const leftKeys = agentKeys(left);
  for (const key of agentKeys(right)) {
    if (leftKeys.has(key)) {
      return true;
    }
  }
  return false;
};

export const mergeBundledAndExtensionAgents = (
  extensionAgents: readonly ParsedAgent[],
): ParsedAgent[] => {
  const merged = loadBundledAgents();
  for (const extensionAgent of extensionAgents) {
    const index = merged.findIndex((agent) =>
      agentsOverlap(agent, extensionAgent),
    );
    if (index >= 0) {
      merged[index] = extensionAgent;
      continue;
    }
    merged.push(extensionAgent);
  }
  return merged;
};

export const getBundledCoreAgentFallback = (
  _agentType: string,
): ParsedAgent | undefined => undefined;
