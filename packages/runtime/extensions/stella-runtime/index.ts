import { loadParsedAgentsFromDir } from "../../kernel/agents/markdown-agent-loader.js";
import type { ExtensionFactory } from "../../kernel/extensions/types.js";
import { resolveRuntimeSourceAsset } from "../../kernel/shared/runtime-paths.js";

const bundledAgentMetadataDir = () =>
  resolveRuntimeSourceAsset("extensions", "stella-runtime", "agent-metadata");

export const loadStellaRuntimeAgents = (
  _stellaDataDir: string,
  agentMetadataDir: string | URL = bundledAgentMetadataDir(),
) => loadParsedAgentsFromDir(agentMetadataDir);

const stellaRuntimeExtension: ExtensionFactory = (pi, services) => {
  for (const agent of loadStellaRuntimeAgents(services.stellaDataDir)) {
    pi.registerAgent(agent);
  }
};

export default stellaRuntimeExtension;
