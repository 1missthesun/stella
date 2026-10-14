import path from "path";

export const stellaAgentShellEnvironment = (context: {
  stellaAppDir?: string;
  stellaDataDir?: string;
  agentId?: string;
}): Record<string, string> => {
  const env: Record<string, string> = {};
  if (context.stellaAppDir) {
    env.STELLA_APP_DIR = path.resolve(context.stellaAppDir);
  }
  if (context.stellaDataDir) {
    env.STELLA_DRAFTS_DIR = path.join(
      path.resolve(context.stellaDataDir),
      "drafts",
    );
  }
  if (context.agentId) env.STELLA_AGENT_ID = context.agentId;
  return env;
};
