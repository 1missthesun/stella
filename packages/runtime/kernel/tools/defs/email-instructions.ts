import { BackendClient } from "@stella/contracts/backend/client";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { ToolDefinition, ToolResult } from "../types.js";
import {
  EMAIL_INSTRUCTIONS_SEARCH_TERMS,
  EMAIL_INSTRUCTIONS_TOOL_DESCRIPTOR,
  formatEmailInstructions,
} from "./email-instructions-def.js";

const failure = (message: string): ToolResult => ({ error: message });

const field = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

export const createEmailInstructionsTool = (options: {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
}): ToolDefinition => ({
  ...EMAIL_INSTRUCTIONS_TOOL_DESCRIPTOR,
  parameters: EMAIL_INSTRUCTIONS_TOOL_DESCRIPTOR.parameters as unknown as Record<string, unknown>,
  replay: "unsafe",
  agentTypes: [AGENT_IDS.ORCHESTRATOR, AGENT_IDS.GENERAL],
  demoted: { searchTerms: EMAIL_INSTRUCTIONS_SEARCH_TERMS },
  execute: async (rawArgs) => {
    const auth = options.getCloudBackendAuth?.();
    if (!auth) return failure("Email sorting needs this computer signed in to Stella.");
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const client = new BackendClient({ baseUrl: auth.baseUrl, getToken: async () => auth.authToken });
    try {
      const action = field(args, "action");
      let head = "";
      if (action === "add") {
        const added = await client.call("email.addRule", {
          text: field(args, "text"),
          when: field(args, "when"),
          action: field(args, "do") === "act" ? "act" : "tell",
        });
        head = `Saved instruction ${added.rule.ruleId}.\n`;
      } else if (action === "remove") {
        await client.call("email.removeRule", { ruleId: field(args, "ruleId") });
      } else if (action === "note") {
        await client.call("email.setNote", { note: field(args, "note") });
      } else if (action !== "list") {
        return failure("action must be add, list, remove or note.");
      }
      const { rules, note } = await client.call("email.rules", {});
      return { result: `${head}${formatEmailInstructions(rules, note)}` };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Email instructions failed.");
    }
  },
});
