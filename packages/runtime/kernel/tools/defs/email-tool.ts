import { BackendClient } from "@stella/contracts/backend/client";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { ToolDefinition } from "../types.js";
import { EMAIL_TOOL_DESCRIPTOR } from "./email-tool-def.js";

export const createEmailTool = (options: {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
}): ToolDefinition => ({
  ...EMAIL_TOOL_DESCRIPTOR,
  parameters: EMAIL_TOOL_DESCRIPTOR.parameters as unknown as Record<string, unknown>,
  replay: "unsafe",
  agentTypes: [AGENT_IDS.ORCHESTRATOR],
  execute: async (rawArgs) => {
    const auth = options.getCloudBackendAuth?.();
    if (!auth) return { error: "Email needs this computer signed in to Stella." };
    const client = new BackendClient({ baseUrl: auth.baseUrl, getToken: async () => auth.authToken });
    try {
      const { text } = await client.call("email.tool", (rawArgs ?? {}) as Record<string, unknown>);
      return { result: text };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Email failed." };
    }
  },
});
