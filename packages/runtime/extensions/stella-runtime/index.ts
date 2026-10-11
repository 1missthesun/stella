import { loadParsedAgentsFromDir } from "../../kernel/agents/markdown-agent-loader.js";
import type { ExtensionFactory } from "../../kernel/extensions/types.js";
import { resolveRuntimeSourceAsset } from "../../kernel/shared/runtime-paths.js";

const bundledAgentMetadataDir = () =>
  resolveRuntimeSourceAsset("extensions", "stella-runtime", "agent-metadata");

/**
 * Register Stella's agents straight from the bundled definitions. The bundle
 * is the single source of truth for system prompts — a product surface, not a
 * user customization point. Prompt bodies are additionally live-read per turn
 * (`loadAgentSystemPrompt`) so dev edits apply without a reload.
 */
export const loadStellaRuntimeAgents = (
  _stellaDataDir: string,
  agentMetadataDir: string | URL = bundledAgentMetadataDir(),
) => loadParsedAgentsFromDir(agentMetadataDir);

/**
 * Stella's runtime extension.
 *
 * Bundles every Stella-specific runtime behavior that used to live as
 * hardcoded calls inside the kernel:
 *
 *   - Agent registration from bundled runtime metadata and prompt bodies
 *
 * Lives in `runtime/extensions/stella-runtime/` so power users can fork
 * any of these behaviors in place. The kernel has no special "bundled"
 * tier anymore — this extension goes through the same loader path as
 * any third-party extension, with `services` (stellaDataDir, stellaAppDir,
 * store) supplied by the runtime at registration time.
 */
const stellaRuntimeExtension: ExtensionFactory = (pi, services) => {
  // Shipped capability metadata and prompt bodies come from this runtime
  // extension. Backend/cloud defaults are derived from these bundled sources;
  // the local home directory is not a second source of prompt ownership.
  for (const agent of loadStellaRuntimeAgents(services.stellaDataDir)) {
    pi.registerAgent(agent);
  }
};

export default stellaRuntimeExtension;
